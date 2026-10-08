import { Injectable } from '@nestjs/common';

interface CounterSeries {
  help: string;
  type: 'counter';
  values: Map<string, number>;
}

interface HistogramSeries {
  help: string;
  type: 'histogram';
  buckets: number[];
  counts: Map<string, number[]>;
  sums: Map<string, number>;
  totals: Map<string, number>;
}

type Series = CounterSeries | HistogramSeries;

const DURATION_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/**
 * Minimal dependency-free Prometheus registry. Tracks request counters and
 * latency histograms plus process gauges, exposed in text exposition format at
 * `GET /metrics` for Prometheus/VictoriaMetrics scraping.
 */
@Injectable()
export class MetricsService {
  private readonly series = new Map<string, Series>();
  private readonly startedAt = Date.now();

  constructor() {
    this.counter('peoplecore_http_requests_total', 'HTTP requests processed');
    this.histogram(
      'peoplecore_http_request_duration_seconds',
      'HTTP request duration in seconds',
      DURATION_BUCKETS,
    );
    this.counter('peoplecore_http_request_errors_total', 'HTTP requests that ended in an error');
    this.counter('peoplecore_background_jobs_total', 'Background jobs processed');
  }

  counter(name: string, help: string): void {
    if (!this.series.has(name)) this.series.set(name, { help, type: 'counter', values: new Map() });
  }

  histogram(name: string, help: string, buckets: number[]): void {
    if (!this.series.has(name)) {
      this.series.set(name, { help, type: 'histogram', buckets, counts: new Map(), sums: new Map(), totals: new Map() });
    }
  }

  increment(name: string, labels: Record<string, string> = {}, value = 1): void {
    const entry = this.series.get(name);
    if (entry?.type !== 'counter') return;
    const key = formatLabels(labels);
    entry.values.set(key, (entry.values.get(key) ?? 0) + value);
  }

  observe(name: string, value: number, labels: Record<string, string> = {}): void {
    const entry = this.series.get(name);
    if (entry?.type !== 'histogram') return;
    const key = formatLabels(labels);
    const counts = entry.counts.get(key) ?? Array.from({ length: entry.buckets.length }, () => 0);
    for (let index = 0; index < entry.buckets.length; index += 1) {
      if (value <= entry.buckets[index]!) counts[index] += 1;
    }
    entry.counts.set(key, counts);
    entry.sums.set(key, (entry.sums.get(key) ?? 0) + value);
    entry.totals.set(key, (entry.totals.get(key) ?? 0) + 1);
  }

  static gauge(name: string, help: string, labels: Record<string, string> = {}, value = 0): string {
    return `# HELP ${name} ${help}\n# TYPE ${name} gauge\n${name}${formatLabels(labels)} ${value}\n`;
  }

  render(extraGauges: string[] = []): string {
    const lines: string[] = [];
    for (const [name, entry] of this.series) {
      lines.push(`# HELP ${name} ${entry.help}`);
      lines.push(`# TYPE ${name} ${entry.type}`);
      if (entry.type === 'counter') {
        for (const [labels, value] of entry.values) lines.push(`${name}${labels} ${value}`);
      } else {
        for (const [labels, counts] of entry.counts) {
          const bucketLabels = labels === '' ? '' : labels.slice(0, -1);
          for (let index = 0; index < entry.buckets.length; index += 1) {
            const separator = bucketLabels ? ',' : '';
            lines.push(
              `${name}_bucket${bucketLabels}${separator}le="${entry.buckets[index]}"} ${counts[index]}`,
            );
          }
          lines.push(`${name}_bucket${bucketLabels}${bucketLabels ? ',' : ''}le="+Inf"} ${entry.totals.get(labels) ?? 0}`);
          lines.push(`${name}_sum${labels} ${entry.sums.get(labels) ?? 0}`);
          lines.push(`${name}_count${labels} ${entry.totals.get(labels) ?? 0}`);
        }
      }
    }

    const memory = process.memoryUsage();
    lines.push(MetricsService.gauge('peoplecore_process_uptime_seconds', 'Process uptime in seconds', {}, Math.round((Date.now() - this.startedAt) / 1000)));
    lines.push(MetricsService.gauge('peoplecore_process_resident_memory_bytes', 'Resident memory size', {}, memory.rss));
    lines.push(MetricsService.gauge('peoplecore_nodejs_heap_bytes', 'V8 heap used', {}, memory.heapUsed));
    lines.push(...extraGauges);

    return `${lines.join('\n')}\n`;
  }
}

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  return `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(',')}}`;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
