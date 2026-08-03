export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface CircleFit {
  readonly center: Point;
  readonly radius: number;
  readonly error: number;
}

const SINGULARITY_TOLERANCE = 1e-12;
export const INFINITY_ERROR_THRESHOLD = 1e-12;

function determinant3(matrix: readonly (readonly number[])[]): number {
  const a = matrix[0]!;
  const b = matrix[1]!;
  const c = matrix[2]!;
  return (
    a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) -
    b[0]! * (a[1]! * c[2]! - a[2]! * c[1]!) +
    c[0]! * (a[1]! * b[2]! - a[2]! * b[1]!)
  );
}

function inverse3(matrix: readonly (readonly number[])[]): number[][] | null {
  const a = matrix;
  const determinant = determinant3(a);
  const rowNormProduct = a.reduce(
    (product, row) => product * Math.hypot(row[0]!, row[1]!, row[2]!),
    1,
  );

  if (
    !Number.isFinite(determinant) ||
    !Number.isFinite(rowNormProduct) ||
    rowNormProduct === 0 ||
    Math.abs(determinant) <= SINGULARITY_TOLERANCE * rowNormProduct
  ) {
    return null;
  }

  return [
    [
      (a[1]![1]! * a[2]![2]! - a[1]![2]! * a[2]![1]!) / determinant,
      (a[0]![2]! * a[2]![1]! - a[0]![1]! * a[2]![2]!) / determinant,
      (a[0]![1]! * a[1]![2]! - a[0]![2]! * a[1]![1]!) / determinant,
    ],
    [
      (a[1]![2]! * a[2]![0]! - a[1]![0]! * a[2]![2]!) / determinant,
      (a[0]![0]! * a[2]![2]! - a[0]![2]! * a[2]![0]!) / determinant,
      (a[0]![2]! * a[1]![0]! - a[0]![0]! * a[1]![2]!) / determinant,
    ],
    [
      (a[1]![0]! * a[2]![1]! - a[1]![1]! * a[2]![0]!) / determinant,
      (a[0]![1]! * a[2]![0]! - a[0]![0]! * a[2]![1]!) / determinant,
      (a[0]![0]! * a[1]![1]! - a[0]![1]! * a[1]![0]!) / determinant,
    ],
  ];
}

export function pathLength(points: readonly Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    length += Math.hypot(current.x - previous.x, current.y - previous.y);
  }
  return length;
}

export function fitCircle(points: readonly Point[]): CircleFit | null {
  if (points.length < 3) return null;

  let x3xy2 = 0;
  let x2yy3 = 0;
  let x2y2 = 0;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  let x = 0;
  let y = 0;

  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const px2 = point.x * point.x;
    const py2 = point.y * point.y;
    x3xy2 += point.x * (px2 + py2);
    x2yy3 += point.y * (px2 + py2);
    x2y2 += px2 + py2;
    xx += px2;
    xy += point.x * point.y;
    yy += py2;
    x += point.x;
    y += point.y;
  }

  const matrix = [
    [xx, xy, x],
    [xy, yy, y],
    [x, y, points.length],
  ];
  const inverse = inverse3(matrix);
  if (inverse === null) return null;

  const coefficientA =
    -x3xy2 * inverse[0]![0]! - x2yy3 * inverse[0]![1]! - x2y2 * inverse[0]![2]!;
  const coefficientB =
    -x3xy2 * inverse[1]![0]! - x2yy3 * inverse[1]![1]! - x2y2 * inverse[1]![2]!;
  const coefficientC =
    -x3xy2 * inverse[2]![0]! - x2yy3 * inverse[2]![1]! - x2y2 * inverse[2]![2]!;
  const center = { x: -coefficientA / 2, y: -coefficientB / 2 };
  const radiusSquared = center.x * center.x + center.y * center.y - coefficientC;

  if (!Number.isFinite(radiusSquared) || radiusSquared <= 0) return null;
  const radius = Math.sqrt(radiusSquared);

  let squaredError = 0;
  for (const point of points) {
    const radialError = Math.hypot(point.x - center.x, point.y - center.y) - radius;
    squaredError += radialError * radialError;
  }
  const error = squaredError / points.length;

  if (
    !Number.isFinite(center.x) ||
    !Number.isFinite(center.y) ||
    !Number.isFinite(radius) ||
    radius === 0 ||
    !Number.isFinite(error)
  ) {
    return null;
  }

  return { center, radius, error };
}

export function formatScore(circle: CircleFit): string | null {
  if (circle.error <= INFINITY_ERROR_THRESHOLD) return "∞";
  const score = (circle.radius * circle.radius) / circle.error;
  return Number.isFinite(score) ? Math.floor(score).toString() : null;
}
