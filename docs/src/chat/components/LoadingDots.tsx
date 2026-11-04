interface LoadingDotsProps {
  className?: string;
  size?: number;
}

export function LoadingDots({
  className = "text-chat-muted",
  size = 16,
}: LoadingDotsProps) {
  const gap = 6;
  const r = 2.5;
  const width = size * 3 + gap * 2;
  const height = size;

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-label="Loading..."
    >
      <circle cx={size / 2} cy={height / 2} r={r} fill="currentColor">
        <animate
          attributeName="opacity"
          values="0.2;1;0.2"
          dur="1s"
          repeatCount="indefinite"
          begin="0s"
        />
      </circle>
      <circle
        cx={size / 2 + size + gap}
        cy={height / 2}
        r={r}
        fill="currentColor"
      >
        <animate
          attributeName="opacity"
          values="0.2;1;0.2"
          dur="1s"
          repeatCount="indefinite"
          begin="0.15s"
        />
      </circle>
      <circle
        cx={size / 2 + (size + gap) * 2}
        cy={height / 2}
        r={r}
        fill="currentColor"
      >
        <animate
          attributeName="opacity"
          values="0.2;1;0.2"
          dur="1s"
          repeatCount="indefinite"
          begin="0.3s"
        />
      </circle>
    </svg>
  );
}
