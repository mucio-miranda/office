/** As paredes em volta de uma sala. */
export function wallsOfRoomIn(r: { x0: number; x1: number; z0: number; z1: number }, walls: { key: string; x: number; z: number; w: number; d: number }[]) {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.2;
  return walls.filter((w) => (w.w > w.d
    ? (near(w.z, r.z0) || near(w.z, r.z1)) && w.x > r.x0 && w.x < r.x1
    : (near(w.x, r.x0) || near(w.x, r.x1)) && w.z > r.z0 && w.z < r.z1)).map((w) => w.key);
}
