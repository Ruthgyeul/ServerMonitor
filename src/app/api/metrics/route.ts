import { getSystemInfo } from '@/utils/systemMonitor';
import { isX86TemperatureInfo } from '@/types/system';

// Prometheus scrape endpoint. This is a monitoring tool with no standard
// exposition format, so long-term storage/alerting could not be delegated to
// Grafana/Prometheus. getSystemInfo() is already cached for 1s, so a scrape
// triggers no extra collection.
//
// Important: sensitive data (SSH source IPs, process names, traffic peers) is
// never emitted — only numeric metrics. Unlike /api/system it can't be used for recon.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Labels = Record<string, string>;

function line(name: string, value: number, labels?: Labels): string {
  if (!labels || Object.keys(labels).length === 0) return `${name} ${value}`;
  const rendered = Object.entries(labels)
    .map(([key, val]) => `${key}="${val.replace(/["\\\n]/g, '_')}"`)
    .join(',');
  return `${name}{${rendered}} ${value}`;
}

export async function GET() {
  const data = await getSystemInfo();
  const out: string[] = [];

  const metric = (name: string, help: string, type: 'gauge' | 'counter', rows: string[]) => {
    if (rows.length === 0) return;
    out.push(`# HELP ${name} ${help}`);
    out.push(`# TYPE ${name} ${type}`);
    out.push(...rows);
  };

  const numeric = (value: number | 'N/A' | null | undefined): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

  const g = (name: string, help: string, value: number | 'N/A' | null | undefined, labels?: Labels) => {
    const v = numeric(value);
    if (v !== null) metric(name, help, 'gauge', [line(name, v, labels)]);
  };

  out.push('# HELP server_up Whether the exporter responded (always 1).');
  out.push('# TYPE server_up gauge');
  out.push(line('server_up', 1));

  g('server_cpu_usage_percent', 'CPU usage across all cores.', data.cpu.usage);
  g('server_cpu_cores', 'Number of logical CPU cores.', data.cpu.cores);
  g('server_cpu_temperature_celsius', 'CPU package temperature.', data.cpu.temperature);
  g('server_cpu_iowait_percent', 'CPU time waiting on I/O.', data.cpu.iowait);
  g('server_cpu_steal_percent', 'CPU time stolen by the hypervisor.', data.cpu.steal);
  g('server_cpu_frequency_mhz', 'Average current CPU clock in MHz.', data.cpu.frequencyMhz);

  g('server_memory_used_mb', 'Used memory in MB.', data.memory.used);
  g('server_memory_total_mb', 'Total memory in MB.', data.memory.total);
  g('server_memory_percent', 'Memory usage percentage.', data.memory.percentage);

  // Root filesystem. If multiple disks (disks[]) are present, expose them per-mount too.
  g('server_disk_percent', 'Disk usage percentage.', data.disk.percentage, { mount: '/' });
  g('server_disk_used_gb', 'Used disk in GB.', data.disk.used, { mount: '/' });
  g('server_disk_total_gb', 'Total disk in GB.', data.disk.total, { mount: '/' });
  g(
    'server_disk_hours_to_full',
    'Estimated hours until root fills at the current rate.',
    data.disk.hoursToFull
  );
  if (data.disks) {
    const rowsPct: string[] = [];
    const rowsUsed: string[] = [];
    const rowsTotal: string[] = [];
    for (const d of data.disks) {
      rowsPct.push(line('server_disk_percent', d.percentage, { mount: d.mount }));
      rowsUsed.push(line('server_disk_used_gb', d.used, { mount: d.mount }));
      rowsTotal.push(line('server_disk_total_gb', d.total, { mount: d.mount }));
    }
    metric('server_disk_percent', 'Disk usage percentage.', 'gauge', rowsPct);
    metric('server_disk_used_gb', 'Used disk in GB.', 'gauge', rowsUsed);
    metric('server_disk_total_gb', 'Total disk in GB.', 'gauge', rowsTotal);
  }

  if (data.swap) g('server_swap_percent', 'Swap usage percentage.', data.swap.percentage);

  g('server_network_download_kbps', 'Download throughput in KB/s.', data.network.download);
  g('server_network_upload_kbps', 'Upload throughput in KB/s.', data.network.upload);
  g('server_network_ping_ms', 'Ping latency in ms.', data.network.ping);
  g('server_network_connections', 'Established connections.', data.network.connections);
  g('server_network_listening_ports', 'Listening ports.', data.network.listeningPorts);
  g('server_network_bandwidth_percent', 'Link bandwidth utilisation.', data.network.bandwidthPercentage);

  if (data.load) {
    g('server_load1', '1-minute load average.', data.load.avg1);
    g('server_load5', '5-minute load average.', data.load.avg5);
    g('server_load15', '15-minute load average.', data.load.avg15);
    g('server_load_running', 'Running/runnable kernel entities.', data.load.running);
  }

  if (data.diskIO) {
    g('server_diskio_read_mbps', 'Disk read throughput in MB/s.', data.diskIO.read);
    g('server_diskio_write_mbps', 'Disk write throughput in MB/s.', data.diskIO.write);
  }

  if (data.gpu) {
    g('server_gpu_usage_percent', 'GPU utilisation.', data.gpu.usage);
    g('server_gpu_temperature_celsius', 'GPU temperature.', data.gpu.temperature);
  }

  const fanRows = (['cpu', 'case1', 'case2'] as const)
    .filter(key => data.fan[key] > 0)
    .map(key => line('server_fan_rpm', data.fan[key], { fan: key }));
  metric('server_fan_rpm', 'Fan speed in RPM.', 'gauge', fanRows);

  // Motherboard / other temperatures (numeric ones only).
  if (isX86TemperatureInfo(data.temperature)) {
    g('server_gpu_edge_temperature_celsius', 'GPU edge temperature.', data.temperature.gpu);
    g('server_motherboard_temperature_celsius', 'Motherboard temperature.', data.temperature.motherboard);
  }

  if (data.processSummary) {
    g('server_processes_total', 'Total processes.', data.processSummary.total);
    g('server_processes_running', 'Running processes.', data.processSummary.running);
    g('server_processes_zombie', 'Zombie processes.', data.processSummary.zombie);
    g('server_threads_total', 'Total tasks including threads.', data.processSummary.threads);
  } else {
    g('server_process_count', 'Number of top processes reported.', data.processes.length);
  }

  if (data.battery) g('server_battery_percent', 'Battery charge level.', data.battery.percentage);

  const alerts = data.alerts ?? [];
  const activeAlerts = alerts.filter(a => a.level === 'warning' || a.level === 'critical').length;
  metric('server_active_alerts', 'Alerts currently at warning/critical.', 'gauge', [
    line('server_active_alerts', activeAlerts)
  ]);

  // The Prometheus text exposition format requires a trailing newline.
  const body = out.join('\n') + '\n';
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}
