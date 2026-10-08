import type { ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { EmptyState } from '../ui/feedback.js';

export type ChartDatum = Record<string, string | number>;

export interface ChartSeries {
  key: string;
  name: string;
  color: string;
}

function ChartFrame(props: { title: string; description?: string; action?: ReactNode; empty: boolean; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>{props.title}</CardTitle>
          {props.description ? <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{props.description}</p> : null}
        </div>
        {props.action}
      </CardHeader>
      <CardContent className="h-72">
        {props.empty ? <EmptyState title="—" /> : <ResponsiveContainer width="100%" height="100%">{props.children}</ResponsiveContainer>}
      </CardContent>
    </Card>
  );
}

/** Single-series bar chart (headcount by department, counts by status, …). */
export function BarPanel(props: {
  title: string;
  description?: string;
  action?: ReactNode;
  data: ChartDatum[];
  xKey: string;
  series: ChartSeries[];
  multiColor?: boolean;
  height?: number;
}) {
  const empty = props.data.length === 0;
  return (
    <ChartFrame title={props.title} description={props.description} action={props.action} empty={empty}>
      <BarChart data={props.data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-200 dark:text-slate-800" />
        <XAxis dataKey={props.xKey} tick={{ fontSize: 12 }} interval={0} angle={-20} textAnchor="end" height={56} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip cursor={{ fill: 'rgba(148, 163, 184, 0.15)' }} />
        <Bar dataKey={props.series[0]?.key ?? 'value'} name={props.series[0]?.name ?? ''} radius={[4, 4, 0, 0]} fill={props.series[0]?.color ?? '#6366f1'}>
          {props.multiColor
            ? props.data.map((_, index) => <Cell key={index} fill={PALETTE[index % PALETTE.length]} />)
            : null}
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}

const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6'];

/** Multi-series area/line chart (attendance or leave trends). */
export function AreaPanel(props: {
  title: string;
  description?: string;
  action?: ReactNode;
  data: ChartDatum[];
  xKey: string;
  series: ChartSeries[];
}) {
  const empty = props.data.length === 0;
  return (
    <ChartFrame title={props.title} description={props.description} action={props.action} empty={empty}>
      <AreaChart data={props.data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <defs>
          {props.series.map((serie) => (
            <linearGradient key={serie.key} id={`gradient-${serie.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={serie.color} stopOpacity={0.35} />
              <stop offset="95%" stopColor={serie.color} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-200 dark:text-slate-800" />
        <XAxis dataKey={props.xKey} tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        {props.series.length > 1 ? <Legend /> : null}
        {props.series.map((serie) => (
          <Area
            key={serie.key}
            type="monotone"
            dataKey={serie.key}
            name={serie.name}
            stroke={serie.color}
            fill={`url(#gradient-${serie.key})`}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    </ChartFrame>
  );
}
