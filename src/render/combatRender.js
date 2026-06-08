// α37 combat — transient visual overlays (arrows + floating damage
// numbers) used by renderer.js. Kept here so future combat visuals
// (muzzle flash, blood splat, banner-flying march column …) can grow
// alongside the existing two effects without piling more methods onto
// the main renderer class.
//
// Each `draw*` helper takes the renderer's already-set-up ctx + the
// projection helpers (proj, elevAt) so it can sit on top of the
// existing isometric layout without owning any of the camera math.

/**
 * Draw every in-flight arrow. Each arrow ages over 0.4 seconds from
 * `bornAt`; its head animates from attacker → target along the line as
 * `t` goes 0 → 1, and the whole streak fades to transparent.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{fromX:number,fromY:number,toX:number,toY:number,bornAt:number}>} arrows
 * @param {(wx:number,wy:number,z:number)=>{x:number,y:number}} proj  world→screen projector
 * @param {(wx:number,wy:number)=>number} elevAt                      world-elev sampler
 * @param {number} now                                                game.clock
 */
export function drawArrows(ctx, arrows, proj, elevAt, now) {
  if (!arrows || arrows.length === 0) return;
  ctx.save();
  for (const a of arrows) {
    const age = now - a.bornAt;
    const t = Math.max(0, Math.min(1, age / 0.4));
    const alpha = 1 - t;
    const from = proj(a.fromX + 0.5, a.fromY + 0.5, elevAt(a.fromX + 0.5, a.fromY + 0.5));
    const to   = proj(a.toX   + 0.5, a.toY   + 0.5, elevAt(a.toX   + 0.5, a.toY   + 0.5));
    const hx = from.x + (to.x - from.x) * t;
    const hy = from.y + (to.y - from.y) * t;
    ctx.strokeStyle = `rgba(245, 240, 220, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.fillStyle = `rgba(220, 140, 60, ${alpha})`;
    ctx.beginPath();
    ctx.arc(hx, hy, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Draw every floating damage number. Each number ages over 1.2 seconds
 * from `bornAt`, rising 24px while fading out.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{x:number,y:number,n:number,bornAt:number}>} damages
 * @param {(wx:number,wy:number,z:number)=>{x:number,y:number}} proj
 * @param {(wx:number,wy:number)=>number} elevAt
 * @param {number} now
 */
export function drawDamageNumbers(ctx, damages, proj, elevAt, now) {
  if (!damages || damages.length === 0) return;
  ctx.save();
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 3;
  for (const d of damages) {
    const age = now - d.bornAt;
    const t = Math.max(0, Math.min(1, age / 1.2));
    const alpha = 1 - t;
    const p = proj(d.x + 0.5, d.y + 0.5, elevAt(d.x + 0.5, d.y + 0.5));
    const py = p.y - 10 - t * 24;
    ctx.strokeStyle = `rgba(40, 12, 12, ${alpha * 0.7})`;
    ctx.fillStyle   = `rgba(255, 90, 90, ${alpha})`;
    ctx.strokeText(`-${d.n}`, p.x, py);
    ctx.fillText(`-${d.n}`, p.x, py);
  }
  ctx.restore();
}
