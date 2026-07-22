#!/bin/bash
# 실제 서버에서 각 지표의 원본 소스가 읽히는지 하나씩 확인한다.
# 앱과 동일한 조건으로 보려면 Next.js 를 띄우는 그 사용자로 실행할 것.
#   ./scripts/diagnose.sh

ok()   { printf '  \033[32mOK\033[0m   %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; }

echo "== 실행 환경 =="
echo "  user : $(whoami)"
echo "  arch : $(uname -m)"
echo "  PATH : $PATH"
echo

echo "== CPU (/proc/stat) =="
if grep -q '^cpu ' /proc/stat 2>/dev/null; then
    ok "$(grep '^cpu ' /proc/stat)"
else
    fail "/proc/stat 를 읽을 수 없음"
fi
echo "  cores: $(nproc 2>/dev/null || echo '?')"
echo

echo "== 메모리 (/proc/meminfo) =="
if grep -E '^(MemTotal|MemAvailable):' /proc/meminfo 2>/dev/null | sed 's/^/  /'; then
    :
else
    fail "/proc/meminfo 를 읽을 수 없음"
fi
echo

echo "== 디스크 (df -Pk /) =="
df -Pk / 2>/dev/null | sed 's/^/  /' || fail "df 실패"
echo

echo "== 네트워크 기본 인터페이스 (/proc/net/route) =="
IFACE=$(awk '$2 == "00000000" { print $1; exit }' /proc/net/route 2>/dev/null)
if [ -n "$IFACE" ]; then
    ok "default route -> $IFACE"
    for stat in rx_bytes tx_bytes rx_packets tx_packets rx_errors tx_errors; do
        value=$(cat "/sys/class/net/$IFACE/statistics/$stat" 2>/dev/null)
        [ -n "$value" ] && echo "  $stat = $value" || fail "$stat 읽기 실패"
    done
else
    fail "기본 경로 없음 — /sys/class/net 후보: $(ls /sys/class/net 2>/dev/null | tr '\n' ' ')"
fi
echo

echo "== Ping (${PING_HOST:-8.8.8.8}) =="
ping -c 1 -W 1 "${PING_HOST:-8.8.8.8}" 2>&1 | grep -E 'time[=<]' | sed 's/^/  /' || fail "응답 없음 (ping 0ms 로 표시됨)"
echo

echo "== 온도 / 팬 =="
if command -v sensors >/dev/null 2>&1; then
    ok "lm-sensors 설치됨"
    sensors 2>/dev/null | sed 's/^/  /'
else
    fail "sensors 없음 — sysfs 로 대체 (sudo apt install lm-sensors 로 설치 가능)"
fi
echo "  -- /sys/class/thermal --"
for zone in /sys/class/thermal/thermal_zone*; do
    [ -r "$zone/temp" ] || continue
    echo "  $(basename "$zone") ($(cat "$zone/type" 2>/dev/null)) = $(cat "$zone/temp" 2>/dev/null)"
done
echo "  -- /sys/class/hwmon fan --"
find /sys/class/hwmon -name 'fan?_input' 2>/dev/null | while read -r f; do
    echo "  $f = $(cat "$f" 2>/dev/null)"
done
echo

echo "== 프로세스 (ps) =="
ps -eo pid,pcpu,pmem,stat,args --sort=-pcpu 2>/dev/null | head -n 4 | sed 's/^/  /' || fail "ps --sort 미지원"
echo

echo "== Uptime =="
echo "  $(cat /proc/uptime 2>/dev/null || echo '읽기 실패')"
