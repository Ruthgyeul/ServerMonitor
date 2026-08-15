# syntax=docker/dockerfile:1

# ServerMonitor 멀티스테이지 이미지. 런타임에는 next standalone 출력만 담아
# 이미지를 작게 유지한다. 지표 수집이 읽는 sensors/ping/ps/df/last/who 등은
# 호스트의 바이너리와 /proc·/sys 를 쓰므로 이미지에 넣지 않는다 —
# docker-compose.yml 의 마운트/네임스페이스 설정을 참고하라.

FROM node:20-alpine AS deps
WORKDIR /app
# 락파일 기준 재현 가능한 설치. package*.json 만 먼저 복사해 레이어 캐시를 살린다.
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* 는 빌드 시 번들에 인라인된다. 클러스터/사이트 메타데이터를 바꾸려면
# --build-arg 로 넘기거나, 배포 후 런타임 값만 쓰는 서버 전용 변수를 사용하라.
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# 지표 수집기가 shell out 하는 호스트 도구를 넣는다. busybox 의 ps 는
# `-eo ... --sort` 를 지원하지 않으므로 GNU procps 가 필요하다. sensors/ping 도
# 마찬가지다. journalctl/systemctl/who/last(systemd·utmp)는 컨테이너에서 얻기
# 어렵지만, 수집기가 이미 N/A 로 우아하게 degrade 하므로 넣지 않는다.
# pid:host + /proc·/sys 마운트(docker-compose.yml)와 함께 써야 호스트를 읽는다.
RUN apk add --no-cache procps lm-sensors iputils

# 루트로 실행하지 않는다. standalone 서버 구동에 필요한 파일만 복사한다.
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 히스토리/알림 영속화 위치(gitignored data/). 볼륨으로 마운트해 재시작에도 유지.
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
VOLUME /app/data

USER nextjs
EXPOSE 3000

# 무거운 /api/system 이 아니라 경량 /api/health 로 헬스체크한다.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
