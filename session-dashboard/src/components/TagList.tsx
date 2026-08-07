export function TagList({
  label,
  values,
  limit,
}: {
  label: string;
  values: string[];
  limit?: number;
}) {
  const visibleValues = typeof limit === "number" ? values.slice(0, limit) : values;
  if (visibleValues.length === 0) return null;

  return (
    <div className="tag-group">
      <span className="visually-hidden">{label}: </span>
      <ul className="tag-list" aria-label={label}>
        {visibleValues.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
    </div>
  );
}
