import { Area, AreaChart, ResponsiveContainer } from "recharts";

type Props = {
  data: number[];
  color?: string;
  height?: number;
};

export function Sparkline({ data, color = "#F59E0B", height = 40 }: Props) {
  if (!data || data.length < 3) return null;
  const chartData = data.map((v, i) => ({ i, v }));
  const gradientId = `spark-grad-${color.replace("#", "")}`;
  return (
    <div className="mt-3 -mx-1" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.75}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}