const center = 250;

const rings = [
  { inner: 36, outer: 100, colors: ["mint", "mint", "peach", "lilac"] },
  { inner: 100, outer: 170, colors: ["peach", "lilac", "yellow", "peach", "mint", "yellow", "yellow", "lilac"] },
  { inner: 170, outer: 238, colors: ["peach", "blue", "peach", "blue", "mint", "lilac", "yellow", "lilac", "blue", "blue", "mint", "blue", "yellow"] },
] as const;

function point(radius: number, degrees: number) {
  const radians = degrees * Math.PI / 180;
  return { x: center + radius * Math.cos(radians), y: center + radius * Math.sin(radians) };
}

export function circularSegments(board: number[]) {
  let offset = 0;
  return rings.flatMap(({ inner, outer, colors }) => {
    const count = colors.length;
    const segments = colors.map((color, index) => {
      const angle = -90 + index * 360 / count;
      const start = angle - 180 / count;
      const end = angle + 180 / count;
      const a = point(outer, start);
      const b = point(outer, end);
      const c = point(inner, end);
      const d = point(inner, start);
      const label = point((inner + outer) / 2, angle);
      return {
        number: board[offset + index], color,
        path: `M ${a.x} ${a.y} A ${outer} ${outer} 0 0 1 ${b.x} ${b.y} L ${c.x} ${c.y} A ${inner} ${inner} 0 0 0 ${d.x} ${d.y} Z`,
        x: label.x, y: label.y,
      };
    });
    offset += count;
    return segments;
  });
}
