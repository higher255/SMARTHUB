/** Tiny dependency-free bar chart for monthly trends. */
export function MiniBars({ data, height = 96, label }: { data: { label: string; value: number }[]; height?: number; label: string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const w = 100 / Math.max(data.length, 1);
  return (
    <figure>
      <svg viewBox={`0 0 100 ${height / 4}`} preserveAspectRatio="none" role="img" aria-label={label} className="w-full" style={{ height }}>
        {data.map((d, i) => {
          const h = (d.value / max) * (height / 4 - 2);
          return <rect key={d.label} x={i * w + w * 0.15} y={height / 4 - h} width={w * 0.7} height={Math.max(h, d.value > 0 ? 0.6 : 0.2)} rx={0.6} className={d.value > 0 ? "fill-accent" : "fill-border"} />;
        })}
      </svg>
      <figcaption className="mt-1 flex justify-between text-[10px] text-fg-subtle">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </figcaption>
    </figure>
  );
}
