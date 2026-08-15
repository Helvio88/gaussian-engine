const VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aPos;
layout(location=2) in vec3 aScale;
layout(location=3) in vec4 aQuat;
layout(location=4) in vec4 aColor;
uniform mat4 uView, uProj;
uniform vec2 uFocal, uViewport;
uniform float uScaleMul;
out vec4 vColor;
out vec2 vLocal;

mat3 quatToMat(vec4 q) {
  float x=q.x, y=q.y, z=q.z, w=q.w;
  float xx=x*x, yy=y*y, zz=z*z;
  float xy=x*y, xz=x*z, yz=y*z, wx=w*x, wy=w*y, wz=w*z;
  return mat3(
    1.0-2.0*(yy+zz), 2.0*(xy+wz), 2.0*(xz-wy),
    2.0*(xy-wz), 1.0-2.0*(xx+zz), 2.0*(yz+wx),
    2.0*(xz+wy), 2.0*(yz-wx), 1.0-2.0*(xx+yy)
  );
}

void main() {
  vec4 viewPos = uView * vec4(aPos, 1.0);
  float tz = -viewPos.z;
  if (tz < 0.05) {
    gl_Position = vec4(0.0, 0.0, -10.0, 1.0);
    vColor = vec4(0.0);
    vLocal = aCorner;
    return;
  }
  vec3 s = max(aScale * uScaleMul, vec3(1e-5));
  mat3 R = quatToMat(normalize(aQuat));
  mat3 cov = R * mat3(s.x*s.x, 0.0, 0.0, 0.0, s.y*s.y, 0.0, 0.0, 0.0, s.z*s.z) * transpose(R);
  float fx = uFocal.x, fy = uFocal.y;
  float tx = viewPos.x, ty = viewPos.y, tz2 = tz * tz;
  mat3 J = mat3(
    fx/tz, 0.0, -fx*tx/tz2,
    0.0, fy/tz, -fy*ty/tz2,
    0.0, 0.0, 0.0
  );
  mat3 W = mat3(uView);
  mat3 T = J * W;
  mat3 cov2 = T * cov * transpose(T);
  float a = cov2[0][0], b = cov2[0][1], c = cov2[1][1];
  float mid = 0.5 * (a + c);
  float rad = length(vec2(a - c, 2.0 * b)) * 0.5;
  float l1 = mid + rad, l2 = mid - rad;
  vec2 e1 = normalize(abs(b) > 1e-8 ? vec2(b, l1 - a) : vec2(1.0, 0.0));
  vec2 e2 = vec2(-e1.y, e1.x);
  float r1 = min(sqrt(max(l1, 0.0)) * 3.0, 512.0);
  float r2 = min(sqrt(max(l2, 0.0)) * 3.0, 512.0);
  vec2 offset = aCorner.x * e1 * r1 + aCorner.y * e2 * r2;
  vec4 clip = uProj * viewPos;
  clip.xy += offset / uViewport * clip.w * 2.0;
  gl_Position = clip;
  vColor = aColor;
  vLocal = aCorner;
}
`;

const FS = `#version 300 es
precision mediump float;
in vec4 vColor;
in vec2 vLocal;
out vec4 o;
void main() {
  float r2 = dot(vLocal, vLocal);
  if (r2 > 1.0) discard;
  float g = exp(-2.5 * r2);
  if (g < 0.015) discard;
  float a = g * vColor.a;
  o = vec4(vColor.rgb * a, a);
}
`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(info || "shader compile failed");
  }
  return sh;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL2 required");
    this.gl = gl;
    gl.clearColor(0.04, 0.04, 0.045, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog) || "program link failed");
    }
    this.prog = prog;
    this.u = {
      view: gl.getUniformLocation(prog, "uView"),
      proj: gl.getUniformLocation(prog, "uProj"),
      focal: gl.getUniformLocation(prog, "uFocal"),
      viewport: gl.getUniformLocation(prog, "uViewport"),
      scale: gl.getUniformLocation(prog, "uScaleMul"),
    };

    this.vao = gl.createVertexArray();
    this.quad = gl.createBuffer();
    this.bPos = gl.createBuffer();
    this.bScale = gl.createBuffer();
    this.bQuat = gl.createBuffer();
    this.bColor = gl.createBuffer();

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);

    this._bindInstanced(1, this.bPos, 3);
    this._bindInstanced(2, this.bScale, 3);
    this._bindInstanced(3, this.bQuat, 4);
    this._bindInstanced(4, this.bColor, 4);

    this.capacity = 0;
    this.drawn = 0;
    this.pos = null;
    this.scale = null;
    this.quat = null;
    this.color = null;
    this.depth = null;
    this.order = null;
  }

  _bindInstanced(loc, buf, size) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(loc, 1);
  }

  ensure(n) {
    if (n <= this.capacity) return;
    const cap = Math.max(n, 4096);
    this.capacity = cap;
    this.pos = new Float32Array(cap * 3);
    this.scale = new Float32Array(cap * 3);
    this.quat = new Float32Array(cap * 4);
    this.color = new Float32Array(cap * 4);
    this.depth = new Float32Array(cap);
    this.order = new Uint32Array(cap);
    this._tp = new Float32Array(cap * 3);
    this._ts = new Float32Array(cap * 3);
    this._tq = new Float32Array(cap * 4);
    this._tc = new Float32Array(cap * 4);
  }

  pack(cloud, tree, picked) {
    this.ensure(picked.length);
    const nodes = tree.nodes;
    const P = cloud.positions,
      S = cloud.scales,
      Q = cloud.rotations,
      C = cloud.colors;
    const pos = this.pos,
      sc = this.scale,
      qt = this.quat,
      col = this.color;
    const n = picked.length;
    for (let i = 0; i < n; i++) {
      const key = picked[i];
      const o3 = i * 3,
        o4 = i * 4;
      if (key < 0) {
        const node = nodes[-key - 1];
        pos[o3] = node.px;
        pos[o3 + 1] = node.py;
        pos[o3 + 2] = node.pz;
        sc[o3] = node.sx;
        sc[o3 + 1] = node.sy;
        sc[o3 + 2] = node.sz;
        qt[o4] = 0;
        qt[o4 + 1] = 0;
        qt[o4 + 2] = 0;
        qt[o4 + 3] = 1;
        col[o4] = node.cr;
        col[o4 + 1] = node.cg;
        col[o4 + 2] = node.cb;
        col[o4 + 3] = node.ca;
      } else {
        const p = key * 3,
          q = key * 4;
        pos[o3] = P[p];
        pos[o3 + 1] = P[p + 1];
        pos[o3 + 2] = P[p + 2];
        sc[o3] = S[p];
        sc[o3 + 1] = S[p + 1];
        sc[o3 + 2] = S[p + 2];
        qt[o4] = Q[q];
        qt[o4 + 1] = Q[q + 1];
        qt[o4 + 2] = Q[q + 2];
        qt[o4 + 3] = Q[q + 3];
        col[o4] = C[q];
        col[o4 + 1] = C[q + 1];
        col[o4 + 2] = C[q + 2];
        col[o4 + 3] = C[q + 3];
      }
    }
    this.drawn = n;
  }

  sortBackToFront(view) {
    const n = this.drawn;
    const pos = this.pos;
    const depth = this.depth;
    const order = this.order;
    const vx = view[2],
      vy = view[6],
      vz = view[10],
      vw = view[14];
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      depth[i] = vx * pos[o] + vy * pos[o + 1] + vz * pos[o + 2] + vw;
      order[i] = i;
    }
    // Back to front: more negative view-z (farther) first.
    order.subarray(0, n).sort((a, b) => depth[a] - depth[b]);

    const tp = this._tp;
    const ts = this._ts;
    const tq = this._tq;
    const tc = this._tc;
    for (let i = 0; i < n; i++) {
      const s = order[i];
      const d3 = i * 3,
        s3 = s * 3,
        d4 = i * 4,
        s4 = s * 4;
      tp[d3] = pos[s3];
      tp[d3 + 1] = pos[s3 + 1];
      tp[d3 + 2] = pos[s3 + 2];
      ts[d3] = this.scale[s3];
      ts[d3 + 1] = this.scale[s3 + 1];
      ts[d3 + 2] = this.scale[s3 + 2];
      tq[d4] = this.quat[s4];
      tq[d4 + 1] = this.quat[s4 + 1];
      tq[d4 + 2] = this.quat[s4 + 2];
      tq[d4 + 3] = this.quat[s4 + 3];
      tc[d4] = this.color[s4];
      tc[d4 + 1] = this.color[s4 + 1];
      tc[d4 + 2] = this.color[s4 + 2];
      tc[d4 + 3] = this.color[s4 + 3];
    }
    this.pos.set(tp);
    this.scale.set(ts);
    this.quat.set(tq);
    this.color.set(tc);
  }

  upload() {
    const gl = this.gl;
    const n = this.drawn;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bPos);
    gl.bufferData(gl.ARRAY_BUFFER, this.pos.subarray(0, n * 3), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bScale);
    gl.bufferData(gl.ARRAY_BUFFER, this.scale.subarray(0, n * 3), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bQuat);
    gl.bufferData(gl.ARRAY_BUFFER, this.quat.subarray(0, n * 4), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bColor);
    gl.bufferData(gl.ARRAY_BUFFER, this.color.subarray(0, n * 4), gl.DYNAMIC_DRAW);
  }

  draw(view, proj, width, height, fovDeg, scaleMul) {
    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    const fy = (0.5 * height) / Math.tan((fovDeg * Math.PI) / 360);
    const fx = fy * (width / Math.max(1, height));
    gl.uniformMatrix4fv(this.u.view, false, view);
    gl.uniformMatrix4fv(this.u.proj, false, proj);
    gl.uniform2f(this.u.focal, fx, fy);
    gl.uniform2f(this.u.viewport, width, height);
    gl.uniform1f(this.u.scale, scaleMul);
    if (this.drawn) {
      gl.bindVertexArray(this.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.drawn);
    }
  }
}
