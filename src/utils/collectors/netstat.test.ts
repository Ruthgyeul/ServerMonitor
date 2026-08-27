import { describe, expect, it } from 'vitest';

import { hexToIpv4, hexToIpv6, parseSocketTable, summarizeSockets } from '@/utils/collectors/netstat';

describe('hexToIpv4', () => {
  it('decodes little-endian hex to dotted quad', () => {
    expect(hexToIpv4('0100007F')).toBe('127.0.0.1');
    expect(hexToIpv4('0F02000A')).toBe('10.0.2.15');
    expect(hexToIpv4('00000000')).toBe('0.0.0.0');
  });

  it('returns a safe default for malformed input', () => {
    expect(hexToIpv4('XYZ')).toBe('0.0.0.0');
  });
});

describe('hexToIpv6', () => {
  it('renders an IPv4-mapped address as IPv4', () => {
    expect(hexToIpv6('0000000000000000FFFF00000100007F')).toBe('127.0.0.1');
  });

  it('collapses the longest zero run per RFC 5952', () => {
    expect(hexToIpv6('00000000000000000000000001000000')).toBe('::1');
  });

  it('returns :: for malformed input', () => {
    expect(hexToIpv6('nope')).toBe('::');
  });
});

// A representative /proc/net/tcp body: header + a LISTEN on :22, an ESTABLISHED
// to an external peer, a loopback ESTABLISHED, and a second hit on the same peer.
const TCP_TABLE = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1001 1 ffff 100
   1: 0100007F:1F90 0F02000A:C001 01 00000000:00000000 00:00000000 00000000  1000        0 2002 1 ffff 100
   2: 0100007F:1F90 0100007F:C002 01 00000000:00000000 00:00000000 00000000  1000        0 3003 1 ffff 100
   3: 0100007F:1F90 0F02000A:C003 01 00000000:00000000 00:00000000 00000000  1000        0 4004 1 ffff 100
`;

describe('parseSocketTable', () => {
  it('parses ports, states, remote IPs, uid and inode', () => {
    const sockets = parseSocketTable(TCP_TABLE, false);
    expect(sockets).toHaveLength(4);
    expect(sockets[0]).toMatchObject({ localPort: 22, state: '0A', remoteIp: '0.0.0.0' });
    expect(sockets[1]).toMatchObject({ localPort: 8080, state: '01', remoteIp: '10.0.2.15', uid: 1000, inode: '2002' });
  });

  it('skips the header and blank lines', () => {
    expect(parseSocketTable('header only\n', false)).toHaveLength(0);
  });
});

describe('summarizeSockets', () => {
  it('counts listeners, established connections, and non-loopback peers', () => {
    const summary = summarizeSockets(parseSocketTable(TCP_TABLE, false));
    expect(summary.listeningPorts).toBe(1);
    expect(summary.connections).toBe(3); // three ESTABLISHED
    // loopback peer excluded; the external peer seen twice ranks as 2 connections.
    expect(summary.peers.get('10.0.2.15')).toBe(2);
    expect(summary.peers.has('127.0.0.1')).toBe(false);
  });
});
