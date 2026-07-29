import { Bar, BarChart, ResponsiveContainer, Cell } from "recharts";

type Props = {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
};

export function MiniBars({ data, color = "#F5A623", height = 44, width = 84 }: Props) {
  if (!data || data.length === 0) return null;
  const chartData = data.map((v, i) => ({ i, v: Math.max(0, v) }));
  const maxIdx = chartData.reduce((m, d, i) => (d.v > chartData[m].v ? i : m), 0);
  return (
    <div style={{ height, width }} className="shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }} barCategoryGap={2}>
          <Bar dataKey="v" radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={color} fillOpacity={i === maxIdx ? 1 : 0.35} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}