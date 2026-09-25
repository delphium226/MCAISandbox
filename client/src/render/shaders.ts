/** GLSL (ES 3.0) shader sources. All lighting is done in linear HDR and tone-mapped in the final pass. */

export const COMMON = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2DArray;
precision highp sampler2DShadow;

uniform float uTime;
uniform vec3 uSunDir;      // direction TO the sun (normalised)
uniform vec3 uSunColor;    // direct sunlight colour * intensity (linear)
uniform vec3 uAmbient;     // sky ambient light colour (linear)
uniform vec3 uMoonColor;
uniform float uDaylight;   // 0 night .. 1 day
uniform float uRain;
uniform vec3 uCamPos;
uniform float uFogStart;
uniform float uFogEnd;
uniform float uUnderwater;

const float PI = 3.14159265;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * .1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}

// ---- Atmosphere -------------------------------------------------------------------------------
vec3 skyZenith() {
  vec3 day = vec3(0.07, 0.19, 0.62);
  vec3 night = vec3(0.004, 0.006, 0.018);
  return mix(night, day, uDaylight);
}
vec3 skyHorizon() {
  vec3 day = vec3(0.34, 0.48, 0.78);
  vec3 night = vec3(0.012, 0.016, 0.035);
  return mix(night, day, uDaylight);
}

/** Sky radiance in direction dir (world space, normalised). Excludes sun/moon discs. */
vec3 skyColor(vec3 dir) {
  float y = max(dir.y, 0.0);
  float h = pow(1.0 - y, 3.0);
  vec3 col = mix(skyZenith(), skyHorizon(), h);
  // Below horizon: fade to a darker haze so the void isn't bright
  
  // Sunrise / sunset glow
  float sunH = uSunDir.y;
  float sunset = clamp(1.0 - abs(sunH) * 3.2, 0.0, 1.0);
  float toward = pow(max(dot(normalize(vec3(dir.x, 0.0, dir.z) + 1e-5), normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-5)), 0.0), 3.0);
  vec3 glow = vec3(1.0, 0.38, 0.12) * sunset * (0.25 + 0.9 * toward) * pow(1.0 - abs(y), 6.0);
  col += glow * 1.3;
  // Mie-ish halo around the sun
  float mu = max(dot(dir, uSunDir), 0.0);
  col += uSunColor * 0.08 * pow(mu, 8.0) * (1.0 - uRain);
  col += uSunColor * 0.25 * pow(mu, 64.0) * (1.0 - uRain);
  // Moon halo
  float mm = max(dot(dir, -uSunDir), 0.0);
  col += vec3(0.3, 0.4, 0.6) * 0.04 * pow(mm, 16.0) * (1.0 - uDaylight);
  // Overcast: desaturate towards grey and darken when raining
  float lum = dot(col, vec3(0.3, 0.5, 0.2));
  col = mix(col, vec3(lum) * 0.85, uRain * 0.85);
  return col * (1.0 - uRain * 0.45);
}

vec3 fogColor(vec3 dir) {
  vec3 d = normalize(vec3(dir.x, max(dir.y, 0.0) * 0.5 + 0.02, dir.z));
  return skyColor(d);
}

vec3 applyFog(vec3 col, vec3 worldPos) {
  vec3 v = worldPos - uCamPos;
  float dist = length(v);
  vec3 dir = v / max(dist, 1e-4);
  if (uUnderwater > 0.5) {
    float f = 1.0 - exp(-dist * 0.08);
    return mix(col, vec3(0.02, 0.07, 0.16) * (0.1 + uDaylight * 0.9), f);
  }
  // Atmospheric haze (exponential, height-dependent) + hard render-distance fog
  float haze = 1.0 - exp(-dist * 0.0011 * (1.0 + uRain * 4.0));
  float edge = smoothstep(uFogStart, uFogEnd, dist);
  float f = max(haze * 0.5, edge);
  return mix(col, fogColor(dir), f);
}

// ---- Minecraft light curve ------------------------------------------------------------------
float lightCurve(float l) {
  // l in 0..1, approximates Minecraft's brightness table (with brightness 'moody'..'bright' in between)
  return l / (4.0 - 3.0 * l);
}
`;

// =====================================================================================
// Terrain
// =====================================================================================
export const TERRAIN_VERT = /* glsl */ `
${COMMON}
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 uShadowMatrix;
uniform mat4 uShadowMatrix2;

in vec4 a_pos;
in vec4 a_tex;
in vec4 a_light;
in vec4 a_color;

out vec3 vWorld;
out vec3 vUv;
flat out int vFlags;
flat out int vNormalIdx;
out vec2 vLight;
out float vAO;
out vec3 vTint;
out vec4 vShadow;
out vec4 vShadow2;

const vec3 NORMALS[7] = vec3[7](vec3(1,0,0), vec3(-1,0,0), vec3(0,1,0), vec3(0,-1,0), vec3(0,0,1), vec3(0,0,-1), vec3(0,1,0));

vec3 wave(vec3 w, int flags, float phase) {
  if ((flags & 1) != 0) {
    float t = uTime * 1.6 + phase * 0.0245;
    w.x += sin(t + w.y * 0.8 + w.z * 0.6) * 0.035 * (1.0 + uRain);
    w.z += cos(t * 0.9 + w.x * 0.7) * 0.035 * (1.0 + uRain);
    w.y += sin(t * 1.3 + w.x) * 0.012;
  }
  if ((flags & 2) != 0) {
    float t = uTime * 2.0 + phase * 0.0245;
    w.x += sin(t + w.x * 0.5 + w.z * 0.3) * 0.08 * (1.0 + uRain);
    w.z += cos(t * 0.8 + w.z * 0.5) * 0.06 * (1.0 + uRain);
  }
  return w;
}

void main() {
  vec3 p = a_pos.xyz / 16.0;
  int flags = int(a_tex.w + 0.5);
  vec4 world = modelMatrix * vec4(p, 1.0);
  world.xyz = wave(world.xyz, flags, a_color.w * 255.0);
  vWorld = world.xyz;
  vUv = vec3(a_tex.xy / 256.0, a_tex.z);
  vFlags = flags;
  vNormalIdx = int(a_pos.w + 0.5);
  vLight = a_light.xy;
  vAO = a_light.z;
  vTint = a_color.rgb;
  vec3 n = NORMALS[vNormalIdx];
  // Normal offset reduces shadow acne
  vec3 sp = world.xyz + n * 0.06;
  vShadow = uShadowMatrix * vec4(sp, 1.0);
  vShadow2 = uShadowMatrix2 * vec4(world.xyz + n * 0.15, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const TERRAIN_FRAG = /* glsl */ `
${COMMON}
uniform sampler2DArray uAtlas;
uniform sampler2DShadow uShadowMap;
uniform sampler2DShadow uShadowMap2;
uniform float uShadowOn;
uniform float uShadowSize;
uniform float uCutout;
uniform float uFlicker;

in vec3 vWorld;
in vec3 vUv;
flat in int vFlags;
flat in int vNormalIdx;
in vec2 vLight;
in float vAO;
in vec3 vTint;
in vec4 vShadow;
in vec4 vShadow2;

layout(location = 0) out vec4 outColor;

const vec3 NORMALS[7] = vec3[7](vec3(1,0,0), vec3(-1,0,0), vec3(0,1,0), vec3(0,-1,0), vec3(0,0,1), vec3(0,0,-1), vec3(0,1,0));
const float FACE_SHADE[7] = float[7](0.6, 0.6, 1.0, 0.5, 0.8, 0.8, 0.9);

float pcf(sampler2DShadow map, vec4 sc, float size) {
  vec3 c = sc.xyz / sc.w;
  if (c.x <= 0.001 || c.x >= 0.999 || c.y <= 0.001 || c.y >= 0.999 || c.z >= 1.0) return -1.0;
  float t = 1.0 / size;
  float s = 0.0;
  // 3x3 PCF with hardware bilinear compare = smooth edges
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++)
      s += texture(map, vec3(c.xy + vec2(x, y) * t, c.z - 0.0004));
  return s / 9.0;
}

float shadowFactor() {
  if (uShadowOn < 0.5) return 1.0;
  float s = pcf(uShadowMap, vShadow, uShadowSize);
  if (s < 0.0) {
    s = pcf(uShadowMap2, vShadow2, uShadowSize);
    if (s < 0.0) return 1.0;
  }
  return s;
}

void main() {
  vec3 uvw = vUv;
  if ((vFlags & 8) != 0) {
    // Lava: world-space UVs with slow flowing distortion so the texture doesn't look tiled
    vec3 nn = NORMALS[vNormalIdx];
    vec2 base = abs(nn.y) > 0.5 ? vWorld.xz : vec2(vWorld.x + vWorld.z, -vWorld.y);
    vec2 flow = vec2(sin(uTime * 0.35 + base.y * 0.6), cos(uTime * 0.3 + base.x * 0.5)) * 0.12;
    uvw.xy = base * 0.5 + flow + vec2(uTime * 0.015, uTime * 0.01);
  }
  vec4 tex = texture(uAtlas, uvw);
  // Alpha test on the base mip so cutout shapes stay crisp at distance
  float a = textureLod(uAtlas, uvw, 0.0).a;
  if (uCutout > 0.5 && a < 0.1) discard;
  vec3 albedo = tex.rgb;
  vec3 tint = pow(vTint, vec3(2.2));
  if ((vFlags & 64) != 0) albedo *= tint;
  if ((vFlags & 16) != 0 && a < 0.75) albedo *= tint;
  // Rain makes exposed ground darker (wet)
  albedo *= 1.0 - 0.22 * uRain * smoothstep(0.8, 1.0, vLight.x);

  vec3 n = NORMALS[vNormalIdx];
  float face = FACE_SHADE[vNormalIdx];
  float ao = mix(0.42, 1.0, vAO);
  ao = ao * ao * (3.0 - 2.0 * ao) * 0.85 + 0.15 * vAO;

  float sky = vLight.x;
  float blk = vLight.y;
  float skyL = lightCurve(sky);
  float blkL = lightCurve(blk);

  // Direct sun / moon light, only where the sky is visible
  float ndl = vNormalIdx == 6 ? 0.6 : max(dot(n, uSunDir), 0.0);
  float mndl = vNormalIdx == 6 ? 0.6 : max(dot(n, -uSunDir), 0.0);
  float exposure = smoothstep(0.55, 0.95, sky);
  float sh = shadowFactor();
  vec3 direct = uSunColor * ndl * sh * exposure + uMoonColor * mndl * sh * exposure;

  vec3 ambient = uAmbient * skyL * face;
  float flick = 1.0 + (vnoise(vec2(uTime * 7.0, 0.0)) - 0.5) * 0.08 * uFlicker;
  vec3 torch = vec3(1.0, 0.62, 0.30) * blkL * 1.35 * flick * face;
  vec3 light = (ambient + direct) * ao + torch * ao + vec3(0.012, 0.012, 0.016) * ao;
  vec3 col = albedo * light;
  if ((vFlags & 32) != 0) col = mix(col, albedo * 1.6, 0.85); // emissive
  if ((vFlags & 8) != 0) {
    // Lava: animated glow
    float t = vnoise(vWorld.xz * 0.6 + uTime * 0.2) * 0.6 + vnoise(vWorld.xz * 1.7 - uTime * 0.25) * 0.4;
    col = albedo * (1.3 + t * 1.2) * vec3(1.0, 0.92, 0.85);
  }
  col = applyFog(col, vWorld);
  outColor = vec4(col, 1.0);
}
`;

export const SHADOW_VERT = /* glsl */ `
${COMMON}
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
in vec4 a_pos;
in vec4 a_tex;
in vec4 a_color;
out vec3 vUv;
flat out int vFlags;
vec3 wave(vec3 w, int flags, float phase) {
  if ((flags & 1) != 0) {
    float t = uTime * 1.6 + phase * 0.0245;
    w.x += sin(t + w.y * 0.8 + w.z * 0.6) * 0.035;
    w.z += cos(t * 0.9 + w.x * 0.7) * 0.035;
  }
  if ((flags & 2) != 0) {
    float t = uTime * 2.0 + phase * 0.0245;
    w.x += sin(t + w.x * 0.5 + w.z * 0.3) * 0.08;
    w.z += cos(t * 0.8 + w.z * 0.5) * 0.06;
  }
  return w;
}
void main() {
  int flags = int(a_tex.w + 0.5);
  vec4 world = modelMatrix * vec4(a_pos.xyz / 16.0, 1.0);
  world.xyz = wave(world.xyz, flags, a_color.w * 255.0);
  vUv = vec3(a_tex.xy / 256.0, a_tex.z);
  vFlags = flags;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const SHADOW_FRAG = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
in vec3 vUv;
flat in int vFlags;
out vec4 outColor;
void main() {
  if ((vFlags & 4) != 0) discard; // water doesn't cast shadows
  float a = textureLod(uAtlas, vUv, 0.0).a;
  if (a < 0.1) discard;
  outColor = vec4(1.0);
}
`;

// =====================================================================================
// Translucent (water, ice, stained glass) — drawn into a separate target and composited.
// =====================================================================================
export const WATER_FRAG = /* glsl */ `
${COMMON}
uniform sampler2DArray uAtlas;
uniform sampler2D uSceneColor;
uniform sampler2D uSceneDepth;
uniform sampler2DShadow uShadowMap;
uniform float uShadowOn;
uniform float uShadowSize;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float uReflections;

in vec3 vWorld;
in vec3 vUv;
flat in int vFlags;
flat in int vNormalIdx;
in vec2 vLight;
in float vAO;
in vec3 vTint;
in vec4 vShadow;
in vec4 vShadow2;

layout(location = 0) out vec4 outColor;

const vec3 NORMALS[7] = vec3[7](vec3(1,0,0), vec3(-1,0,0), vec3(0,1,0), vec3(0,-1,0), vec3(0,0,1), vec3(0,0,-1), vec3(0,1,0));

float linearDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

float waveHeight(vec2 p) {
  float t = uTime;
  float h = 0.0;
  h += sin(dot(p, vec2(0.8, 0.6)) * 1.3 + t * 1.7) * 0.05;
  h += sin(dot(p, vec2(-0.5, 0.9)) * 2.1 + t * 2.3) * 0.03;
  h += sin(dot(p, vec2(0.3, -0.95)) * 3.7 + t * 3.1) * 0.015;
  h += (vnoise(p * 1.7 + vec2(t * 0.6, t * 0.4)) - 0.5) * 0.06;
  h += (vnoise(p * 4.3 - vec2(t * 0.8, -t * 0.5)) - 0.5) * 0.025;
  return h;
}

vec3 waveNormal(vec2 p) {
  float e = 0.08;
  float hx = waveHeight(p + vec2(e, 0.0)) - waveHeight(p - vec2(e, 0.0));
  float hz = waveHeight(p + vec2(0.0, e)) - waveHeight(p - vec2(0.0, e));
  return normalize(vec3(-hx / (2.0 * e), 1.0, -hz / (2.0 * e)));
}

vec3 viewToScreen(vec3 v) {
  vec4 c = projectionMatrix * vec4(v, 1.0);
  return vec3(c.xy / c.w * 0.5 + 0.5, c.z / c.w * 0.5 + 0.5);
}

// Screen-space reflection (coarse ray march in view space)
vec4 ssr(vec3 worldPos, vec3 rdir) {
  vec3 vp = (viewMatrix * vec4(worldPos, 1.0)).xyz;
  vec3 vd = normalize((viewMatrix * vec4(rdir, 0.0)).xyz);
  float stepLen = 0.6;
  vec3 p = vp;
  for (int i = 0; i < 40; i++) {
    p += vd * stepLen;
    stepLen *= 1.1;
    vec3 s = viewToScreen(p);
    if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || p.z > -uNear) break;
    float sceneZ = linearDepth(texture(uSceneDepth, s.xy).r);
    float rayZ = -p.z;
    if (rayZ > sceneZ + 0.05 && rayZ - sceneZ < stepLen * 2.5 + 0.5) {
      if (texture(uSceneDepth, s.xy).r >= 0.99999) break;
      float edge = smoothstep(0.0, 0.12, min(min(s.x, 1.0 - s.x), min(s.y, 1.0 - s.y)));
      return vec4(texture(uSceneColor, s.xy).rgb, edge);
    }
  }
  return vec4(0.0);
}

void main() {
  vec2 suv = gl_FragCoord.xy / uResolution;
  float sceneD = texture(uSceneDepth, suv).r;
  if (gl_FragCoord.z > sceneD + 1e-6) discard; // manual depth test against opaque scene
  vec3 V = normalize(uCamPos - vWorld);
  float sky = vLight.x, blk = vLight.y;
  vec3 lightCol = uAmbient * lightCurve(sky) + vec3(1.0, 0.62, 0.3) * lightCurve(blk) * 1.2 + vec3(0.01);
  float sh = 1.0;
  if (uShadowOn > 0.5) {
    vec3 c = vShadow.xyz / vShadow.w;
    if (c.x > 0.0 && c.x < 1.0 && c.y > 0.0 && c.y < 1.0 && c.z < 1.0) sh = texture(uShadowMap, vec3(c.xy, c.z - 0.0006));
  }
  float exposure = smoothstep(0.55, 0.95, sky);

  if ((vFlags & 4) == 0) {
    // Glass / ice / stained glass: tinted blend over the scene
    vec4 tex = texture(uAtlas, vUv);
    vec3 n = NORMALS[vNormalIdx];
    vec3 lit = tex.rgb * (lightCol + uSunColor * max(dot(n, uSunDir), 0.0) * sh * exposure);
    vec3 behind = texture(uSceneColor, suv).rgb;
    vec3 col = mix(behind * mix(vec3(1.0), tex.rgb * 1.2, tex.a), lit, tex.a * 0.7);
    col = applyFog(col, vWorld);
    outColor = vec4(col, 1.0);
    return;
  }

  // ---- Water ----
  vec3 tint = pow(vTint, vec3(2.2));
  vec3 geoN = NORMALS[vNormalIdx];
  bool top = vNormalIdx == 2;
  bool fromBelow = vNormalIdx == 3 && uCamPos.y < vWorld.y;
  vec3 N = geoN;
  if (top || vNormalIdx == 3) {
    N = waveNormal(vWorld.xz);
    if (vNormalIdx == 3) N = vec3(N.x, -N.y, N.z);
  }
  float dist = length(uCamPos - vWorld);
  N = normalize(mix(N, geoN, clamp(dist / 120.0, 0.0, 0.8)));

  // Refraction
  vec2 offs = N.xz * 0.035 / max(1.0, dist * 0.05);
  vec2 ruv = clamp(suv + offs, 0.001, 0.999);
  if (texture(uSceneDepth, ruv).r < gl_FragCoord.z) ruv = suv;
  vec3 refr = texture(uSceneColor, ruv).rgb;
  float dScene = linearDepth(texture(uSceneDepth, ruv).r);
  float dWater = linearDepth(gl_FragCoord.z);
  float depth = max(dScene - dWater, 0.0);
  if (uUnderwater > 0.5) depth = 0.0;
  vec3 waterCol = tint * vec3(0.35, 0.55, 0.65) * (lightCol + uSunColor * 0.25 * exposure);
  vec3 absorb = exp(-depth * vec3(0.45, 0.16, 0.10) * 1.2);
  vec3 under = mix(waterCol, refr, absorb * 0.92);

  // Reflection
  vec3 R = reflect(-V, N);
  if (R.y < 0.0) R.y = -R.y * 0.3;
  vec3 refl = skyColor(normalize(R)) * mix(0.35, 1.0, exposure);
  if (uReflections > 0.5 && top) {
    vec4 s = ssr(vWorld, R);
    refl = mix(refl, s.rgb, s.a);
  }
  float cosT = clamp(dot(N, V), 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
  fres = clamp(fres, 0.0, 1.0) * (top ? 1.0 : 0.3);
  if (fromBelow || uUnderwater > 0.5) fres = 0.0;
  vec3 col = mix(under, refl, fres);

  // Sun specular
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(N, H), 0.0), 220.0) * 6.0;
  col += uSunColor * spec * sh * exposure * (top ? 1.0 : 0.0);
  col += vec3(0.6, 0.7, 0.9) * pow(max(dot(N, normalize(-uSunDir + V)), 0.0), 300.0) * 1.5 * (1.0 - uDaylight) * exposure;

  col = applyFog(col, vWorld);
  outColor = vec4(col, 1.0);
}
`;

// =====================================================================================
// Sky (fullscreen triangle at far plane)
// =====================================================================================
export const SKY_VERT = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

export const SKY_FRAG = /* glsl */ `
${COMMON}
uniform mat4 uInvViewProj;
in vec2 vNdc;
layout(location = 0) out vec4 outColor;

float starField(vec3 dir) {
  vec3 p = dir * 180.0;
  vec3 cell = floor(p);
  float h = hash13(cell);
  if (h < 0.9965) return 0.0;
  vec3 f = fract(p) - 0.5;
  float d = length(f);
  float tw = 0.6 + 0.4 * sin(uTime * (1.0 + h * 5.0) + h * 100.0);
  return smoothstep(0.35, 0.0, d) * tw * (h - 0.9965) / 0.0035;
}

void main() {
  vec4 p = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(p.xyz / p.w - uCamPos);
  vec3 col = skyColor(dir);
  if (uUnderwater > 0.5) {
    outColor = vec4(vec3(0.02, 0.07, 0.16) * (0.1 + uDaylight * 0.9), 1.0);
    return;
  }
  // Stars
  float night = 1.0 - smoothstep(0.0, 0.35, uDaylight);
  if (dir.y > 0.0) col += vec3(0.8, 0.85, 1.0) * starField(dir) * night * 0.9 * (1.0 - uRain);
  // Sun: square-ish disc like Minecraft, with soft bloom halo
  vec3 sd = uSunDir;
  vec3 right = normalize(cross(sd, vec3(0.0, 0.0, 1.0)));
  vec3 up = cross(right, sd);
  float fd = dot(dir, sd);
  if (fd > 0.0) {
    vec2 q = vec2(dot(dir, right), dot(dir, up)) / fd;
    float sq = max(abs(q.x), abs(q.y));
    float disc = 1.0 - smoothstep(0.075, 0.082, sq);
    col += vec3(1.0, 0.95, 0.8) * disc * 18.0 * (1.0 - uRain);
  }
  // Moon (opposite the sun), with simple phase-free craters
  vec3 md = -sd;
  float fm = dot(dir, md);
  if (fm > 0.0) {
    vec2 q = vec2(dot(dir, right), dot(dir, up)) / fm;
    float sq = max(abs(q.x), abs(q.y));
    float disc = 1.0 - smoothstep(0.055, 0.06, sq);
    float crater = vnoise(q * 60.0) * 0.35 + 0.65;
    col += vec3(0.75, 0.8, 0.9) * disc * crater * 2.2 * (1.0 - uRain);
  }
  outColor = vec4(col, 1.0);
}
`;

// =====================================================================================
// Clouds (blocky Minecraft-style, flat-shaded boxes)
// =====================================================================================
export const CLOUD_VERT = /* glsl */ `
precision highp float;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
in vec3 normal;
out vec3 vWorld;
out vec3 vN;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normal;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const CLOUD_FRAG = /* glsl */ `
${COMMON}
in vec3 vWorld;
in vec3 vN;
layout(location = 0) out vec4 outColor;
void main() {
  float shade = vN.y > 0.5 ? 1.0 : vN.y < -0.5 ? 0.65 : (abs(vN.x) > 0.5 ? 0.8 : 0.88);
  vec3 base = mix(vec3(0.025, 0.03, 0.045), vec3(1.0), clamp(uDaylight * 1.1, 0.0, 1.0));
  base = mix(base, base * vec3(1.0, 0.75, 0.6), clamp(1.0 - abs(uSunDir.y) * 3.0, 0.0, 1.0) * uDaylight);
  base = mix(base, vec3(0.5) * (0.08 + uDaylight * 0.9), uRain * 0.85);
  vec3 col = base * shade;
  vec3 v = vWorld - uCamPos;
  float dist = length(v.xz);
  float fade = 1.0 - smoothstep(uFogEnd * 1.6, uFogEnd * 2.6, dist);
  col = mix(fogColor(normalize(v)), col, 0.85);
  outColor = vec4(col, 0.82 * fade);
}
`;

// =====================================================================================
// Entities (box models)
// =====================================================================================
export const ENTITY_VERT = /* glsl */ `
precision highp float;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
in vec3 position;
in vec3 normal;
in vec2 uv;
out vec2 vUv;
out vec3 vN;
out vec3 vWorld;
void main() {
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const ENTITY_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D uTex;
uniform vec2 uLight;     // sky, block (0..1)
uniform vec3 uTintColor;
uniform float uHurt;
uniform float uWhite;    // creeper fuse flash
in vec2 vUv;
in vec3 vN;
in vec3 vWorld;
layout(location = 0) out vec4 outColor;
void main() {
  vec4 tex = texture(uTex, vUv);
  if (tex.a < 0.1) discard;
  vec3 albedo = tex.rgb * uTintColor;
  vec3 n = normalize(vN);
  float face = 0.6 + 0.4 * (n.y * 0.5 + 0.5) - abs(n.x) * 0.12;
  float skyL = lightCurve(uLight.x);
  float blkL = lightCurve(uLight.y);
  float exposure = smoothstep(0.55, 0.95, uLight.x);
  vec3 light = uAmbient * skyL * face + uSunColor * max(dot(n, uSunDir), 0.0) * exposure * 0.8 + uMoonColor * max(dot(n, -uSunDir), 0.0) * exposure
             + vec3(1.0, 0.62, 0.3) * blkL * 1.3 * face + vec3(0.015);
  vec3 col = albedo * light;
  col = mix(col, vec3(0.9, 0.05, 0.02) * (0.3 + skyL + blkL), uHurt * 0.55);
  col = mix(col, vec3(2.0), uWhite * 0.6);
  col = applyFog(col, vWorld);
  outColor = vec4(col, 1.0);
}
`;

// =====================================================================================
// Post processing
// =====================================================================================
export const FULLSCREEN_VERT = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const COMPOSITE_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D uScene;
uniform sampler2D uSceneDepth;
uniform sampler2D uTrans;
uniform sampler2D uTransDepth;
uniform vec2 uSunScreen;     // sun position in uv space
uniform float uSunVisible;   // 0..1 (in front of camera & above horizon)
uniform float uGodrays;
uniform float uNear;
uniform float uFar;
in vec2 vUv;
layout(location = 0) out vec4 outColor;

float linearDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

void main() {
  ivec2 pix = ivec2(gl_FragCoord.xy);
  vec3 col = texelFetch(uScene, pix, 0).rgb;
  vec4 tr = texelFetch(uTrans, pix, 0);
  col = mix(col, tr.rgb, clamp(tr.a, 0.0, 1.0));
  float d = min(texelFetch(uSceneDepth, pix, 0).r, tr.a > 0.5 ? texelFetch(uTransDepth, pix, 0).r : 1.0);

  // Crepuscular rays: march towards the sun accumulating sky visibility
  if (uGodrays > 0.5 && uSunVisible > 0.0 && uUnderwater < 0.5) {
    vec2 delta = (uSunScreen - vUv) / 32.0;
    vec2 p = vUv;
    float illum = 0.0;
    float decay = 1.0;
    for (int i = 0; i < 32; i++) {
      p += delta;
      if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) break;
      float s = texture(uSceneDepth, p).r >= 0.99999 ? 1.0 : 0.0;
      illum += s * decay;
      decay *= 0.965;
    }
    illum /= 32.0;
    float falloff = 1.0 - smoothstep(0.0, 0.9, length((vUv - uSunScreen) * vec2(1.6, 1.0)));
    col += uSunColor * illum * falloff * uSunVisible * 0.22;
  }
  // Underwater: extra depth fog and blue tint
  if (uUnderwater > 0.5) {
    float ld = linearDepth(d);
    float f = 1.0 - exp(-ld * 0.09);
    vec3 wc = vec3(0.02, 0.07, 0.16) * (0.1 + uDaylight * 0.9);
    col = mix(col * vec3(0.55, 0.8, 1.0), wc, f);
    // gentle caustic shimmer
    col *= 1.0 + 0.04 * sin(vUv.x * 40.0 + uTime * 2.0) * sin(vUv.y * 30.0 + uTime * 1.7);
  }
  outColor = vec4(col, 1.0);
}
`;

export const BRIGHT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uTex;
uniform float uThreshold;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = max(l - uThreshold, 0.0) / max(l, 1e-4);
  outColor = vec4(c * k, 1.0);
}
`;

export const BLUR_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uOffset;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  // Dual Kawase-style 5-tap
  vec3 s = texture(uTex, vUv).rgb * 4.0;
  s += texture(uTex, vUv + uTexel * vec2(uOffset, uOffset)).rgb;
  s += texture(uTex, vUv + uTexel * vec2(-uOffset, uOffset)).rgb;
  s += texture(uTex, vUv + uTexel * vec2(uOffset, -uOffset)).rgb;
  s += texture(uTex, vUv + uTexel * vec2(-uOffset, -uOffset)).rgb;
  outColor = vec4(s / 8.0, 1.0);
}
`;

export const FINAL_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uTex;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform float uExposure;
uniform float uVignette;
uniform float uSaturation;
uniform vec3 uFlash;      // damage red flash etc.
uniform float uFlashAmt;
uniform float uTime;
in vec2 vUv;
layout(location = 0) out vec4 outColor;

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec3 col = texture(uTex, vUv).rgb;
  col += texture(uBloom, vUv).rgb * uBloomStrength;
  col *= uExposure;
  col = aces(col);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSaturation);
  // Vignette
  vec2 q = vUv - 0.5;
  col *= 1.0 - dot(q, q) * uVignette;
  col = mix(col, uFlash, uFlashAmt);
  col = pow(col, vec3(1.0 / 2.2));
  // Dither to avoid banding
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
}
`;
