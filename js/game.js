/* =========================================================================
   무술 격투 3D  —  Three.js 기반 로컬 3D 격투 게임
   ========================================================================= */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   *  상수 / 설정
   * ------------------------------------------------------------------ */
  const ARENA_RADIUS   = 6.4;
  const GRAVITY        = -13.5;      // units/s^2
  const JUMP_VSPEED    = 5.6;        // units/s
  const MOVE_SPEED     = 3.1;        // units/s (base, scaled by style.speed)
  const MIN_SEPARATION = 0.85;       // 겹침 방지 최소 거리
  const ROUND_TIME     = 60;         // 초
  const ROUNDS_TO_WIN  = 2;
  const DOUBLE_TAP_MS  = 300;

  const STYLES = {
    taekwondo: {
      key: 'taekwondo', name: '태권도', desc: '스피드와 발차기에 특화된 유파',
      speed: 1.18, power: 0.9, color: 0x33c7ff, accent: 0xffffff,
      special: 'spinKick', specialName: '회전 발차기'
    },
    karate: {
      key: 'karate', name: '가라테', desc: '강력한 정권 지르기를 구사',
      speed: 0.98, power: 1.2, color: 0xff4d4d, accent: 0xffe27a,
      special: 'straightPunch', specialName: '진권 관수'
    },
    kungfu: {
      key: 'kungfu', name: '쿵푸', desc: '균형 잡힌 만능형 유파',
      speed: 1.06, power: 1.05, color: 0xffcf3a, accent: 0x333333,
      special: 'flyingKick', specialName: '비룡각'
    }
  };

  // 방향 입력에 따라 자동으로 선택되는 타격기 정의
  const ATTACKS = {
    jab:        { group: 'punch', startup: .08, active: .06, recovery: .11, reach: 1.20, cone: .85, dmg: 5,  meter: 8,  hitstun: .22, blockstun: .13, push: 1.2 },
    straight:   { group: 'punch', startup: .14, active: .07, recovery: .17, reach: 1.45, cone: .70, dmg: 9,  meter: 12, hitstun: .32, blockstun: .18, push: 2.1 },
    elbow:      { group: 'punch', startup: .05, active: .05, recovery: .13, reach: 1.00, cone: .95, dmg: 7,  meter: 9,  hitstun: .26, blockstun: .15, push: 1.5 },
    bodyBlow:   { group: 'punch', startup: .10, active: .06, recovery: .15, reach: 1.10, cone: .85, dmg: 6,  meter: 9,  hitstun: .24, blockstun: .14, push: 1.3, low: true },
    frontKick:  { group: 'kick',  startup: .14, active: .08, recovery: .17, reach: 1.50, cone: .78, dmg: 8,  meter: 11, hitstun: .30, blockstun: .18, push: 2.2 },
    roundhouse: { group: 'kick',  startup: .21, active: .10, recovery: .23, reach: 1.65, cone: .70, dmg: 13, meter: 16, hitstun: .42, blockstun: .24, push: 3.0 },
    spinBack:   { group: 'kick',  startup: .25, active: .09, recovery: .27, reach: 1.60, cone: .65, dmg: 15, meter: 17, hitstun: .46, blockstun: .26, push: 3.4 },
    sweep:      { group: 'kick',  startup: .17, active: .08, recovery: .25, reach: 1.50, cone: .80, dmg: 8,  meter: 13, hitstun: .30, blockstun: .20, push: 1.6, low: true, knockdown: true },
    special:    { group: 'special', startup: .24, active: .14, recovery: .28, reach: 1.75, cone: .90, dmg: 20, meter: 0, hitstun: .55, blockstun: .32, push: 3.4 }
  };
  const ATTACK_NAMES = Object.keys(ATTACKS);

  /* ------------------------------------------------------------------ *
   *  Blender-MCP 베이크 애니메이션 커브 (blender/fight_curves.json)
   *  Blender 그래프 에디터에서 베지어 이징으로 직접 제작한 챔버->임팩트->오버슈트->정착
   *  키프레임을 30fps로 샘플링해 내보낸 데이터. 로드되면 해당 동작의 절차적 공식을 대체한다.
   * ------------------------------------------------------------------ */
  let BAKED_CURVES = null;
  fetch('blender/fight_curves.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => { BAKED_CURVES = data; })
    .catch(() => { BAKED_CURVES = null; });

  function lerpVec3(a, b, k) {
    return {
      x: a.x + (b.x - a.x) * k,
      y: (a.y || 0) + ((b.y || 0) - (a.y || 0)) * k,
      z: (a.z || 0) + ((b.z || 0) - (a.z || 0)) * k
    };
  }

  function sampleBakedCurve(moveName, t) {
    const move = BAKED_CURVES && BAKED_CURVES.moves && BAKED_CURVES.moves[moveName];
    if (!move || !move.frames || !move.frames.length) return null;
    const frames = move.frames;
    const tc = Math.max(0, Math.min(t, move.duration));
    let a = frames[0], b = frames[frames.length - 1];
    if (tc <= a.t) { a = b = frames[0]; }
    else if (tc >= frames[frames.length - 1].t) { a = b = frames[frames.length - 1]; }
    else {
      for (let i = 0; i < frames.length - 1; i++) {
        if (tc >= frames[i].t && tc <= frames[i + 1].t) { a = frames[i]; b = frames[i + 1]; break; }
      }
    }
    const span = b.t - a.t;
    const k = span > 0 ? (tc - a.t) / span : 0;
    const lerp = (x, y) => x + (y - x) * k;
    return {
      torsoRotX: lerp(a.torsoRotX, b.torsoRotX),
      torsoRotY: lerp(a.torsoRotY, b.torsoRotY),
      torsoRotZ: lerp(a.torsoRotZ, b.torsoRotZ),
      headRotX: lerp(a.headRotX, b.headRotX),
      hipsX: lerp(a.hipsX, b.hipsX),
      hipsY: lerp(a.hipsY, b.hipsY),
      eL: lerp(a.eL, b.eL), eR: lerp(a.eR, b.eR),
      kL: lerp(a.kL, b.kL), kR: lerp(a.kR, b.kR),
      sL: lerpVec3(a.sL, b.sL, k), sR: lerpVec3(a.sR, b.sR, k),
      hL: lerpVec3(a.hL, b.hL, k), hR: lerpVec3(a.hR, b.hR, k)
    };
  }

  /* ------------------------------------------------------------------ *
   *  전역 상태
   * ------------------------------------------------------------------ */
  let scene, camera1, camera2, renderer, clock;
  let floorMesh, effectsGroup;
  let fighters = [];           // [p1, p2]
  let particles = [];
  let gameMode = '1p';         // '1p' | '2p'
  let pickedStyle = { p1: 'taekwondo', p2: 'karate' };
  let matchState = 'menu';     // menu | fighting | roundend | matchend | paused
  let roundTimer = ROUND_TIME;
  let roundWins = [0, 0];
  let roundNumber = 1;
  let camShake = 0;
  let stateTimer = 0;

  const keys = {};             // held state
  const pressed = {};          // edge-triggered, cleared on consume()
  const lastPressTime = {};    // for double-tap detection
  const doubleTap = {};        // edge-triggered double-tap flags

  /* ------------------------------------------------------------------ *
   *  입력
   * ------------------------------------------------------------------ */
  window.addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (!keys[k]) {
      pressed[k] = true;
      const now = performance.now();
      if (now - (lastPressTime[k] || 0) < DOUBLE_TAP_MS) doubleTap[k] = true;
      lastPressTime[k] = now;
    }
    keys[k] = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    keys[k] = false;
  });

  function consume(key) {
    if (pressed[key]) { pressed[key] = false; return true; }
    return false;
  }
  function consumeDT(key) {
    if (doubleTap[key]) { doubleTap[key] = false; return true; }
    return false;
  }

  /* ------------------------------------------------------------------ *
   *  캔버스 텍스처 유틸 (외부 이미지 없이 절차적 생성)
   * ------------------------------------------------------------------ */
  function makeFloorTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#7a4a32';
    ctx.fillRect(0, 0, 512, 512);
    const cols = 8;
    const cell = 512 / cols;
    for (let y = 0; y < cols; y++) {
      for (let x = 0; x < cols; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#835336' : '#7a4a32';
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= cols; i++) {
      ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, 512); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(512, i * cell); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,235,200,0.55)';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(256, 256, 220, 0, Math.PI * 2); ctx.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  function makeSkyTexture() {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 256;
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#1a0f2e');
    grad.addColorStop(0.45, '#3a1f4d');
    grad.addColorStop(0.75, '#7a3a3a');
    grad.addColorStop(1, '#d9793a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 16, 256);
    return new THREE.CanvasTexture(c);
  }

  /* ------------------------------------------------------------------ *
   *  씬 초기화
   * ------------------------------------------------------------------ */
  function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2a1830);
    scene.fog = new THREE.Fog(0x2a1830, 14, 30);

    camera1 = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
    camera1.position.set(0, 3.4, 8.5);
    camera2 = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
    camera2.position.set(0, 3.4, -8.5);

    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas'), antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const skyGeo = new THREE.SphereGeometry(40, 16, 16, 0, Math.PI * 2, 0, Math.PI / 1.6);
    const skyMat = new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.position.y = -2;
    scene.add(sky);

    const ambient = new THREE.AmbientLight(0x8899ff, 0.55);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffe0b0, 1.1);
    dir.position.set(5, 10, 6);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.left = -10; dir.shadow.camera.right = 10;
    dir.shadow.camera.top = 10; dir.shadow.camera.bottom = -10;
    scene.add(dir);
    const rim = new THREE.DirectionalLight(0x66aaff, 0.5);
    rim.position.set(-6, 5, -6);
    scene.add(rim);

    const floorGeo = new THREE.CircleGeometry(ARENA_RADIUS + 1.4, 48);
    const floorMat = new THREE.MeshStandardMaterial({ map: makeFloorTexture(), roughness: 0.9 });
    floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    const ringGeo = new THREE.TorusGeometry(ARENA_RADIUS + 1.35, 0.18, 8, 48);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: 0.7 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.05;
    scene.add(ring);

    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const px = Math.cos(a) * (ARENA_RADIUS + 3.2);
      const pz = Math.sin(a) * (ARENA_RADIUS + 3.2);
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.26, 4.6, 8),
        new THREE.MeshStandardMaterial({ color: 0x5c2a2a, roughness: 0.8 })
      );
      pillar.position.set(px, 2.3, pz);
      pillar.castShadow = true;
      scene.add(pillar);
      const lantern = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffb347 })
      );
      lantern.position.set(px, 4.3, pz);
      scene.add(lantern);
      const lLight = new THREE.PointLight(0xffa030, 0.6, 6);
      lLight.position.copy(lantern.position);
      scene.add(lLight);
    }

    effectsGroup = new THREE.Group();
    scene.add(effectsGroup);

    clock = new THREE.Clock();
    window.addEventListener('resize', onResize);
  }

  function onResize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /* ------------------------------------------------------------------ *
   *  Fighter 클래스 — 절차적 애니메이션 휴머노이드
   * ------------------------------------------------------------------ */
  class Fighter {
    constructor(styleKey, x, facing, name, isP1) {
      this.style = STYLES[styleKey];
      this.name = name;
      this.isP1 = isP1;
      this.x = x; this.z = 0; this.y = 0;
      this.vx = 0; this.vy = 0; this.vz = 0;
      this.facing = facing;
      this.yaw = facing;
      this.hp = 100; this.maxHp = 100;
      this.meter = 0;
      this.action = 'idle';
      this.actionT = 0;
      this.actionDur = 0;
      this.hasHit = false;
      this.atkOrigin = { x: 0, z: 0 };
      this.atkYaw = 0;
      this.grounded = true;
      this.walkPhase = 0;
      this.idlePhase = Math.random() * 10;
      this.sideTargetZ = 0;
      this.sideReturnAt = 0;
      this.sideCooldown = 0;
      this.dashCooldown = 0;
      this.evading = false;
      this.evadeUntil = 0;
      this.hitFlash = 0;
      this.blocking = false;
      this.aiState = { timer: 0, decision: 'approach', jukeCd: 0 };
      this.build();
    }

    build() {
      const col = this.style.color;
      const skin = 0xf1c27d;
      const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.08 });
      const matSkin = mat(skin);
      const matGi = mat(col);
      const matAccent = mat(this.style.accent);
      const matDark = mat(0x1c1c22);

      const root = new THREE.Group();
      root.position.set(this.x, 0, this.z);
      root.rotation.y = this.yaw;

      const seg = (w, h, d, m) => {
        const g = new THREE.BoxGeometry(w, h, d);
        const mesh = new THREE.Mesh(g, m);
        mesh.position.y = -h / 2;
        mesh.castShadow = true; mesh.receiveShadow = true;
        return mesh;
      };

      const hips = new THREE.Group();
      hips.position.y = 0.98;
      root.add(hips);

      const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.22, 0.28), matDark);
      pelvis.castShadow = true;
      hips.add(pelvis);

      const torsoPivot = new THREE.Group();
      hips.add(torsoPivot);
      const torso = seg(0.5, 0.58, 0.3, matGi);
      torso.position.y = 0.29;
      torsoPivot.add(torso);
      const belt = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 0.32), matAccent);
      belt.position.y = 0.03;
      torsoPivot.add(belt);

      const neck = new THREE.Group();
      neck.position.y = 0.58;
      torsoPivot.add(neck);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), matSkin);
      head.position.y = 0.2;
      head.castShadow = true;
      neck.add(head);
      const headband = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.025, 6, 12), matAccent);
      headband.rotation.x = Math.PI / 2;
      headband.position.y = 0.21;
      neck.add(headband);

      const makeArm = (side) => {
        const shoulder = new THREE.Group();
        shoulder.position.set(0.34 * side, 0.5, 0);
        torsoPivot.add(shoulder);
        const upper = seg(0.15, 0.34, 0.15, matGi);
        shoulder.add(upper);
        const elbow = new THREE.Group();
        elbow.position.y = -0.34;
        shoulder.add(elbow);
        const lower = seg(0.13, 0.32, 0.13, matSkin);
        elbow.add(lower);
        const hand = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15), matSkin);
        hand.position.y = -0.4;
        hand.castShadow = true;
        elbow.add(hand);
        return { shoulder, elbow, hand };
      };

      const makeLeg = (side) => {
        const hip = new THREE.Group();
        hip.position.set(0.16 * side, 0, 0);
        hips.add(hip);
        const upper = seg(0.19, 0.44, 0.2, matDark);
        hip.add(upper);
        const knee = new THREE.Group();
        knee.position.y = -0.44;
        hip.add(knee);
        const lower = seg(0.16, 0.42, 0.16, matGi);
        knee.add(lower);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.13, 0.3), matDark);
        foot.position.set(0, -0.48, 0.05);
        foot.castShadow = true;
        knee.add(foot);
        return { hip, knee, foot };
      };

      const armL = makeArm(-1);
      const armR = makeArm(1);
      const legL = makeLeg(-1);
      const legR = makeLeg(1);

      scene.add(root);

      this.root = root;
      this.parts = { hips, torsoPivot, neck, head, armL, armR, legL, legR };

      const spot = new THREE.PointLight(col, 0.9, 3.2);
      spot.position.set(0, 1.6, 0.6);
      root.add(spot);
    }

    dispose() { scene.remove(this.root); }

    startAction(name, dur) {
      this.action = name;
      this.actionT = 0;
      this.actionDur = dur || 0;
      this.hasHit = false;
      if (ATTACKS[name]) {
        this.atkOrigin.x = this.x; this.atkOrigin.z = this.z;
        this.atkYaw = this.yaw;
      }
    }

    isLocked() {
      return ATTACKS[this.action] !== undefined ||
        ['hitstun', 'blockstun', 'ko', 'win', 'knockdown', 'backdash', 'dash'].includes(this.action);
    }

    canAct() {
      return ['idle', 'walk', 'crouch', 'block'].includes(this.action) && this.grounded;
    }

    applyDamage(amount, stunAction, stunDur, pushDir, pushAmt) {
      this.hp = Math.max(0, this.hp - amount);
      this.startAction(stunAction, 0);
      this.stunDur = stunDur;
      this.vx = pushDir * pushAmt;
      this.hitFlash = 0.25;
      if (this.hp <= 0 && stunAction === 'hitstun') this.startAction('ko', 999);
    }

    applyKnockdown(amount, pushDir) {
      this.hp = Math.max(0, this.hp - amount);
      this.startAction('knockdown', 1.05);
      this.vx = pushDir * 1.6;
      this.hitFlash = 0.25;
      if (this.hp <= 0) this.startAction('ko', 999);
    }

    update(dt, opponent) {
      this.actionT += dt;
      if (this.hitFlash > 0) this.hitFlash -= dt;
      if (this.sideCooldown > 0) this.sideCooldown -= dt;
      if (this.dashCooldown > 0) this.dashCooldown -= dt;
      if (this.evadeUntil && performance.now() > this.evadeUntil) { this.evading = false; this.evadeUntil = 0; }

      const atkDef = ATTACKS[this.action];

      if (this.action === 'hitstun' || this.action === 'blockstun') {
        if (this.actionT >= this.stunDur) this.startAction('idle', 0);
      } else if (atkDef) {
        const total = atkDef.startup + atkDef.active + atkDef.recovery;
        if (this.actionT >= total) this.startAction('idle', 0);
      } else if (this.actionDur && this.actionT >= this.actionDur) {
        this.startAction('idle', 0);
      }

      // 사이드스텝 스프링 (z축 복귀)
      if (this.sideReturnAt && performance.now() > this.sideReturnAt) {
        this.sideTargetZ = 0;
        this.sideReturnAt = 0;
      }
      this.z += (this.sideTargetZ - this.z) * Math.min(1, 9 * dt);

      // 중력/점프
      if (!this.grounded) {
        this.vy += GRAVITY * dt;
        this.y += this.vy * dt;
        if (this.y <= 0) {
          this.y = 0; this.vy = 0; this.grounded = true;
          if (this.action === 'jump') this.startAction('idle', 0);
        }
      }

      // 넉백/대시 관성
      if (['hitstun', 'blockstun', 'backdash', 'dash'].includes(this.action)) {
        this.x += this.vx * dt;
        this.vx *= Math.max(0, 1 - 8 * dt);
      }

      // 아레나 경계
      const distFromCenter = Math.hypot(this.x, this.z);
      if (distFromCenter > ARENA_RADIUS) {
        const s = ARENA_RADIUS / distFromCenter;
        this.x *= s; this.z *= s;
      }

      // 자동 페이싱
      if (opponent) {
        const dx = opponent.x - this.x, dz = opponent.z - this.z;
        this.facing = Math.atan2(dx, dz);
        if (!this.isLocked()) {
          let diff = this.facing - this.yaw;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          this.yaw += diff * Math.min(1, 10 * dt);
        }
      }

      this.root.position.set(this.x, this.y, this.z);
      this.root.rotation.y = this.yaw;

      this.pose(dt);
    }

    // 절차적 포즈 계산 -----------------------------------------------
    pose(dt) {
      const p = this.parts;
      let torsoRotX = 0, torsoRotZ = 0, torsoRotY = 0, headRotX = 0;
      let sL = { x: 0.15, y: 0, z: 0.05 }, sR = { x: 0.15, y: 0, z: -0.05 };
      let eL = -0.25, eR = -0.25;
      let hL = { x: 0.05, y: 0, z: 0 }, hR = { x: -0.05, y: 0, z: 0 };
      let kL = -0.05, kR = -0.05;
      let hipsY = 0.98, hipsX = 0;

      const t = this.actionT;

      if (this.action === 'idle') {
        this.idlePhase += dt;
        const b = Math.sin(this.idlePhase * 2.0);
        hipsY = 0.98 + b * 0.015;
        torsoRotX = 0.04 + b * 0.01;
        torsoRotY = Math.sin(this.idlePhase * 0.55) * 0.035;
        sL.x = 0.25 + b * 0.05; sR.x = 0.25 - b * 0.05;
        eL = -0.3; eR = -0.3;
        headRotX = -0.05;
      } else if (this.action === 'walk') {
        this.walkPhase += dt * 8.5 * this.style.speed;
        const w = Math.sin(this.walkPhase);
        hL.x = w * 0.55; hR.x = -w * 0.55;
        kL = Math.max(0, -w) * 0.7 - 0.1; kR = Math.max(0, w) * 0.7 - 0.1;
        sL.x = 0.2 - w * 0.3; sR.x = 0.2 + w * 0.3;
        torsoRotX = 0.08;
        hipsY = 0.98 + Math.abs(Math.cos(this.walkPhase)) * 0.03;
      } else if (this.action === 'crouch' || this.action === 'block') {
        hipsY = 0.8;
        torsoRotX = 0.12;
        sL = { x: 1.3, z: 0.5 }; sR = { x: 1.3, z: -0.5 };
        eL = -1.6; eR = -1.6;
        hL.x = 0.35; hR.x = -0.35;
        kL = -0.5; kR = -0.5;
        headRotX = 0.1;
      } else if (this.action === 'jump') {
        hL.x = 0.5; hR.x = 0.5;
        kL = -0.9; kR = -0.9;
        sL.x = -0.6; sR.x = -0.6;
        torsoRotX = -0.05;
      } else if (this.action === 'dash') {
        torsoRotX = 0.28;
        sL = { x: 0.35, z: 0.15 }; sR = { x: 0.35, z: -0.15 };
        hL.x = 0.3; hR.x = -0.3;
      } else if (this.action === 'backdash') {
        const prog = Math.min(1, t / 0.32);
        torsoRotX = -0.15 - 0.1 * (1 - prog);
        sL = { x: 0.9, z: 0.4 }; sR = { x: 0.9, z: -0.4 };
        eL = -1.4; eR = -1.4;
        hL.x = 0.3; hR.x = 0.3;
        hipsY = 0.98 - 0.05 * Math.sin(prog * Math.PI);
      } else if (this.action === 'knockdown') {
        const dur = 1.05;
        const prog = Math.min(1, t / dur);
        let fall;
        if (prog < 0.3) fall = prog / 0.3;
        else if (prog < 0.62) fall = 1;
        else fall = Math.max(0, 1 - (prog - 0.62) / 0.38);
        torsoRotX = fall * (Math.PI / 2.05);
        hipsY = 0.98 - fall * 0.78;
        headRotX = fall * 0.25;
        sL = { x: -0.2 - fall * 0.1, z: 0.5 * fall }; sR = { x: -0.2 - fall * 0.1, z: -0.5 * fall };
        hL.x = fall * 0.3; hR.x = fall * 0.25;
      } else if (ATTACKS[this.action] && this.action !== 'special') {
        const A = ATTACKS[this.action];
        // Blender-MCP로 제작된 베이크 커브(챔버->임팩트->오버슈트->정착, 베지어 이징)가 있으면 그것을 재생하고,
        // 아직 로드 전이거나 데이터가 없는 동작이면 기존 절차적 공식으로 자연스럽게 폴백한다.
        const baked = sampleBakedCurve(this.action, t);
        const ap = baked || this.computeAttackPose(this.action, this.attackCurve(t, A));
        torsoRotX = ap.torsoRotX || 0; torsoRotZ = ap.torsoRotZ || 0; torsoRotY = ap.torsoRotY || 0;
        headRotX = ap.headRotX !== undefined ? ap.headRotX : headRotX;
        sL = ap.sL || sL; sR = ap.sR || sR;
        eL = ap.eL !== undefined ? ap.eL : eL; eR = ap.eR !== undefined ? ap.eR : eR;
        hL = ap.hL || hL; hR = ap.hR || hR;
        kL = ap.kL !== undefined ? ap.kL : kL; kR = ap.kR !== undefined ? ap.kR : kR;
        hipsY = ap.hipsY !== undefined ? ap.hipsY : hipsY;
        hipsX = ap.hipsX || 0;
        if (this.action === 'spinBack') {
          // 회전 킥의 몸 전체 회전은 커브 데이터가 아니라 루트 yaw 자체를 돌리는 것이므로 별도 유지.
          const prog = this.attackCurve(t, A);
          this.yaw = this.atkYaw + Math.max(0, prog) * Math.PI * 1.15 - Math.max(0, -prog) * 0.35;
        } else if (ap.yawOverride !== undefined) {
          this.yaw = ap.yawOverride;
        }
        this.resolveHit(this.action, A);
      } else if (this.action === 'special') {
        const A = ATTACKS.special;
        const prog = this.attackCurve(t, A);
        const ch = Math.max(0, -prog), sp = Math.max(0, prog);
        if (this.style.special === 'spinKick') {
          this.yaw = this.atkYaw + sp * Math.PI * 2 - ch * 0.4;
          hR = { x: -0.3 - ch * 0.6 - sp * 1.9, y: -sp * 1.4 }; kR = 0.3 + ch * 1.0 - sp * 0.7;
          hL = { x: 0.25 + ch * 0.15, y: sp * 0.4 };
          sL = { x: 0.65 + ch * 0.15, z: 0.45 }; sR = { x: 0.65, z: -0.6, y: sp * 0.25 };
          hipsY = 0.98 - ch * 0.04 + sp * 0.14;
          hipsX = sp * 0.05;
          torsoRotZ = sp * 0.15;
        } else if (this.style.special === 'straightPunch') {
          torsoRotX = 0.1 + ch * 0.1 + sp * 0.14;
          torsoRotY = sp * 0.32 - ch * 0.18;
          hipsX = sp * 0.2 - ch * 0.06;
          sR = { x: 0.3 + ch * 1.4 - sp * 2.5, z: 0, y: -sp * 0.22 };
          eR = -0.5 - ch * 0.5 + sp * 0.5;
          sL = { x: 0.4 + ch * 0.2, z: 0.24 }; eL = -1.15;
          hL.x = 0.12; hR.x = -0.12;
        } else { // flyingKick
          if (this.grounded && t < 0.02) { this.vy = JUMP_VSPEED * 0.7; this.grounded = false; }
          hR = { x: -0.5 - ch * 0.6 - sp * 1.5 }; kR = 0.25 + ch * 0.9 - sp * 0.9;
          hL = { x: 0.4 + ch * 0.2 }; kL = -0.35;
          sL = { x: 0.65 + ch * 0.15, z: 0.35 }; sR = { x: 0.95, z: -0.25, y: sp * 0.2 };
          torsoRotX = -0.22 - sp * 0.05;
          torsoRotY = sp * 0.2;
        }
        this.resolveHit('special', A);
      } else if (this.action === 'hitstun') {
        const prog = Math.min(1, t / this.stunDur);
        torsoRotX = -0.25 * (1 - prog) - 0.05;
        torsoRotZ = -Math.sign(this.vx || 1) * 0.18 * (1 - prog);
        headRotX = -0.3 * (1 - prog);
        sL = { x: -0.4, z: 0.2 }; sR = { x: -0.4, z: -0.2 };
        hipsY = 0.98 - 0.03 * (1 - prog);
      } else if (this.action === 'blockstun') {
        const prog = Math.min(1, t / this.stunDur);
        sL = { x: 1.3, z: 0.5 }; sR = { x: 1.3, z: -0.5 };
        eL = -1.6; eR = -1.6;
        torsoRotX = 0.15 + 0.1 * (1 - prog);
        hipsY = 0.9;
      } else if (this.action === 'ko') {
        const prog = Math.min(1, t / 0.6);
        torsoRotX = prog * (Math.PI / 2.1);
        hipsY = 0.98 - prog * 0.75;
        headRotX = prog * 0.3;
        sL = { x: -0.3, z: 0.6 }; sR = { x: -0.3, z: -0.6 };
      } else if (this.action === 'win') {
        const b = Math.sin(this.actionT * 3);
        sR = { x: -2.6 + b * 0.1, z: -0.3 };
        eR = -0.2;
        sL = { x: 0.3, z: 0.3 };
        headRotX = -0.15;
        hipsY = 0.98 + Math.abs(Math.sin(this.actionT * 3)) * 0.05;
      }

      // 사이드스텝/이동에 따른 부가적인 몸 기울임 (모든 상태 공통 가산 — 회피 동작을 더 실감나게)
      const sideLean = Math.max(-0.35, Math.min(0.35, -this.z * 0.4 + this.sideTargetZ * -0.15));
      torsoRotZ += sideLean;
      headRotX += Math.abs(sideLean) * 0.15;

      const ease = Math.min(1, dt * 22);
      p.hips.position.y += (hipsY - p.hips.position.y) * ease;
      p.torsoPivot.position.x += (hipsX - p.torsoPivot.position.x) * ease;
      p.torsoPivot.rotation.x += (torsoRotX - p.torsoPivot.rotation.x) * ease;
      p.torsoPivot.rotation.z += (torsoRotZ - p.torsoPivot.rotation.z) * ease;
      p.torsoPivot.rotation.y += (torsoRotY - p.torsoPivot.rotation.y) * ease;
      p.neck.rotation.x += (headRotX - p.neck.rotation.x) * ease;
      p.armL.shoulder.rotation.x += (sL.x - p.armL.shoulder.rotation.x) * ease;
      p.armL.shoulder.rotation.z += (sL.z - p.armL.shoulder.rotation.z) * ease;
      p.armL.shoulder.rotation.y += ((sL.y || 0) - p.armL.shoulder.rotation.y) * ease;
      p.armR.shoulder.rotation.x += (sR.x - p.armR.shoulder.rotation.x) * ease;
      p.armR.shoulder.rotation.z += (sR.z - p.armR.shoulder.rotation.z) * ease;
      p.armR.shoulder.rotation.y += ((sR.y || 0) - p.armR.shoulder.rotation.y) * ease;
      p.armL.elbow.rotation.x += (eL - p.armL.elbow.rotation.x) * ease;
      p.armR.elbow.rotation.x += (eR - p.armR.elbow.rotation.x) * ease;
      p.legL.hip.rotation.x += (hL.x - p.legL.hip.rotation.x) * ease;
      p.legL.hip.rotation.z += ((hL.z || 0) - p.legL.hip.rotation.z) * ease;
      p.legL.hip.rotation.y += ((hL.y || 0) - p.legL.hip.rotation.y) * ease;
      p.legR.hip.rotation.x += (hR.x - p.legR.hip.rotation.x) * ease;
      p.legR.hip.rotation.z += ((hR.z || 0) - p.legR.hip.rotation.z) * ease;
      p.legR.hip.rotation.y += ((hR.y || 0) - p.legR.hip.rotation.y) * ease;
      p.legL.knee.rotation.x += (kL - p.legL.knee.rotation.x) * ease;
      p.legR.knee.rotation.x += (kR - p.legR.knee.rotation.x) * ease;
    }

    // 예비동작(챔버) -> 스냅(타격) -> 복귀 형태의 다이나믹 타이밍 커브.
    // 음수 구간 = 반대 방향으로 감아들이는 예비동작(안티시페이션), 0->1 = 폭발적 스냅, 이후 감쇠 복귀.
    attackCurve(t, A) {
      const chamberEnd = A.startup * 0.55;
      const snapEnd = A.startup;
      const activeEnd = A.startup + A.active;
      const recoverEnd = activeEnd + A.recovery;
      if (chamberEnd > 0 && t < chamberEnd) {
        const k = t / chamberEnd;
        return -0.3 * Math.sin(k * Math.PI / 2);
      }
      if (t < snapEnd) {
        const span = Math.max(0.0001, snapEnd - chamberEnd);
        const k = Math.min(1, (t - chamberEnd) / span);
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        return -0.3 + e * 1.3;
      }
      if (t < activeEnd) return 1.0;
      const span2 = Math.max(0.0001, recoverEnd - activeEnd);
      const k2 = Math.min(1, (t - activeEnd) / span2);
      return Math.cos(k2 * Math.PI / 2);
    }

    // 방향 기반 타격기별 포즈 — ch(챔버 예비동작 강도 0~0.3) / sp(스냅·타격 진행도 0~1) -------------------------------------------
    computeAttackPose(name, prog) {
      const ch = Math.max(0, -prog);
      const sp = Math.max(0, prog);
      switch (name) {
        case 'jab':
          return {
            torsoRotY: sp * 0.22 - ch * 0.10, torsoRotX: 0.04 + sp * 0.09,
            hipsX: sp * 0.09 - ch * 0.03,
            sR: { x: 0.35 + ch * 1.3 - sp * 2.05, z: -0.06 - sp * 0.08, y: -sp * 0.15 },
            eR: -0.35 - ch * 0.55 + sp * 0.32,
            sL: { x: 0.5 + sp * 0.12, z: 0.32 + ch * 0.15, y: ch * 0.1 }, eL: -0.95 - ch * 0.15,
            hL: { x: 0.12 + sp * 0.06 }, hR: { x: -0.12 - sp * 0.06 }
          };
        case 'straight':
          return {
            torsoRotY: sp * 0.42 - ch * 0.16, torsoRotX: 0.05 + sp * 0.22,
            hipsX: sp * 0.18 - ch * 0.05, hipsY: 0.98 - ch * 0.03 + sp * 0.015,
            sR: { x: 0.28 + ch * 1.5 - sp * 2.55, z: -0.04 - sp * 0.12, y: -sp * 0.2 },
            eR: -0.4 - ch * 0.5 + sp * 0.42,
            sL: { x: 0.55 + sp * 0.3, z: 0.36 + ch * 0.15, y: ch * 0.12 }, eL: -1.05 - ch * 0.15,
            hL: { x: 0.18 + sp * 0.1, z: sp * 0.08 }, hR: { x: -0.18 - sp * 0.06, z: -sp * 0.05 }
          };
        case 'elbow':
          return {
            torsoRotY: sp * 0.62 - ch * 0.2, torsoRotX: 0.08 + sp * 0.16, torsoRotZ: sp * 0.12,
            hipsX: sp * 0.05,
            sR: { x: 1.05 + ch * 0.4 - sp * 0.4, z: -0.7 - sp * 0.15, y: sp * 0.3 }, eR: -2.4,
            sL: { x: 0.4, z: 0.26 }, eL: -0.95,
            hL: { x: 0.1 }, hR: { x: -0.1 }
          };
        case 'bodyBlow':
          return {
            torsoRotX: 0.38 + ch * 0.12 + sp * 0.14, torsoRotY: sp * 0.26 - ch * 0.1,
            hipsX: sp * 0.07, hipsY: 0.84 - ch * 0.04,
            sR: { x: 0.6 + ch * 0.4 - sp * 1.7, z: -0.18, y: -sp * 0.1 }, eR: -0.5 + sp * 0.1,
            sL: { x: 0.62, z: 0.32 }, eL: -0.95,
            hL: { x: 0.15 }, hR: { x: -0.15 }
          };
        case 'frontKick':
          return {
            torsoRotZ: 0.1 + sp * 0.08, torsoRotX: -0.05 - sp * 0.14 + ch * 0.08, torsoRotY: -ch * 0.15 + sp * 0.1,
            hipsY: 0.98 - ch * 0.05 + sp * 0.08, hipsX: -ch * 0.04 + sp * 0.1,
            hR: { x: -0.5 - ch * 0.7 - sp * 1.55, y: sp * 0.1 }, kR: 0.35 + ch * 0.95 - sp * 0.55,
            hL: { x: 0.15 + ch * 0.1 }, kL: -0.1 - ch * 0.15,
            sL: { x: 0.75 + ch * 0.2, z: 0.4 }, sR: { x: 0.55 + ch * 0.3, z: -0.45 - sp * 0.1 }
          };
        case 'roundhouse':
          return {
            torsoRotZ: 0.2 + sp * 0.32, torsoRotX: -0.1 - sp * 0.1 + ch * 0.1, torsoRotY: -ch * 0.2 + sp * 0.55,
            hipsY: 0.98 - ch * 0.04 + sp * 0.14, hipsX: sp * 0.06,
            hR: { x: -0.35 - ch * 0.75 - sp * 1.1, y: -ch * 0.2 - sp * 1.2, z: sp * 0.9 },
            kR: 0.4 + ch * 1.0 - sp * 0.75,
            hL: { x: 0.2 + ch * 0.15, y: -sp * 0.35 }, kL: -0.15 - ch * 0.1,
            sL: { x: 0.85 + ch * 0.15, z: 0.55 }, sR: { x: 0.55, z: -0.75 - sp * 0.15, y: sp * 0.2 }
          };
        case 'spinBack':
          return {
            torsoRotX: -0.1 - sp * 0.05, torsoRotZ: sp * 0.1,
            hipsY: 0.98 - ch * 0.03 + sp * 0.15, hipsX: sp * 0.04,
            hR: { x: -0.2 - ch * 0.5 - sp * 1.9, z: 0.25 + sp * 0.15 }, kR: 0.3 + ch * 0.9 - sp * 0.65,
            hL: { x: 0.2 + ch * 0.1, y: sp * 0.3 }, kL: -0.1,
            sL: { x: 0.7 + ch * 0.15, z: 0.42 }, sR: { x: 0.7, z: -0.55 },
            yawOverride: this.atkYaw + sp * Math.PI * 1.15 - ch * 0.35
          };
        case 'sweep':
          return {
            torsoRotX: 0.5 + ch * 0.15, torsoRotZ: -0.12 - sp * 0.08, torsoRotY: sp * 0.2,
            hipsY: 0.7 - ch * 0.06 + sp * 0.02,
            hR: { x: 0.4 + ch * 0.3 - sp * 0.2, z: sp * 1.05 }, kR: -0.15 - ch * 0.2,
            hL: { x: 0.55 + ch * 0.15 }, kL: -0.85 - ch * 0.1,
            sL: { x: 0.5, z: 0.42 }, sR: { x: 0.3 + ch * 0.2, z: -0.42 }
          };
        default:
          return {};
      }
    }

    resolveHit(kind, A) {
      if (this.hasHit) return;
      if (this.actionT < A.startup || this.actionT > A.startup + A.active) return;
      const other = this._opponentRef;
      if (!other || other.action === 'ko') return;
      const dx = other.x - this.atkOrigin.x, dz = other.z - this.atkOrigin.z;
      const dist = Math.hypot(dx, dz);
      if (dist > A.reach) return;
      let ang = Math.atan2(dx, dz) - this.atkYaw;
      ang = Math.atan2(Math.sin(ang), Math.cos(ang));
      if (Math.abs(ang) > A.cone) return;

      this.hasHit = true;

      if (other.evading) {
        spawnHitEffect(other.x, 1.3, other.z, 0x66ffe0, 7);
        camShake = Math.max(camShake, 0.05);
        return;
      }

      const power = this.style.power;
      const dmgFull = A.dmg * power;
      const pushDir = Math.sign(other.x - this.x) || 1;
      const otherFacingMe = Math.abs(Math.atan2(this.x - other.x, this.z - other.z) - other.yaw) < 1.4;
      const blocked = (other.action === 'block' || other.action === 'crouch') && otherFacingMe;
      const shakeAmt = Math.min(0.4, 0.03 + dmgFull * 0.018);

      if (blocked) {
        other.applyDamage(dmgFull * 0.18, 'blockstun', A.blockstun, pushDir, A.push * 0.5);
        spawnHitEffect(other.x, 1.1, other.z, 0x66ccff, 6);
        camShake = Math.max(camShake, shakeAmt * 0.5);
      } else if (A.knockdown) {
        other.applyKnockdown(dmgFull, pushDir);
        spawnHitEffect(other.x, 0.5, other.z, 0xffcc33, 10);
        camShake = Math.max(camShake, shakeAmt);
      } else {
        other.applyDamage(dmgFull, 'hitstun', A.hitstun, pushDir, A.push);
        spawnHitEffect(other.x, 1.2, other.z, 0xffcc33, 10);
        camShake = Math.max(camShake, kind === 'special' ? 0.35 : shakeAmt);
      }
      this.meter = Math.min(100, this.meter + A.meter);
      other.meter = Math.min(100, other.meter + A.meter * 0.6);
    }
  }

  /* ------------------------------------------------------------------ *
   *  히트/회피 이펙트 파티클
   * ------------------------------------------------------------------ */
  function spawnHitEffect(x, y, z, color, count) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.07, 0.07),
        new THREE.MeshBasicMaterial({ color, transparent: true })
      );
      m.position.set(x, y, z);
      const ang = Math.random() * Math.PI * 2;
      const spd = 1.5 + Math.random() * 2.5;
      m.userData.v = new THREE.Vector3(Math.cos(ang) * spd, Math.random() * 3, Math.sin(ang) * spd);
      m.userData.life = 0.35 + Math.random() * 0.15;
      m.userData.maxLife = m.userData.life;
      effectsGroup.add(m);
      particles.push(m);
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const m = particles[i];
      m.userData.life -= dt;
      if (m.userData.life <= 0) {
        effectsGroup.remove(m);
        particles.splice(i, 1);
        continue;
      }
      m.userData.v.y += GRAVITY * dt * 0.5;
      m.position.addScaledVector(m.userData.v, dt);
      m.material.opacity = m.userData.life / m.userData.maxLife;
      m.scale.setScalar(m.material.opacity);
    }
  }

  /* ------------------------------------------------------------------ *
   *  회피 동작 (사이드스텝 / 백대시 / 대시)
   * ------------------------------------------------------------------ */
  function doSidestep(f, dir) {
    f.sideTargetZ = dir * 1.3;
    f.sideReturnAt = performance.now() + 240;
    f.sideCooldown = 0.5;
    f.evading = true;
    f.evadeUntil = performance.now() + 200;
    spawnHitEffect(f.x, 1.0, f.z, 0x66ffe0, 4);
  }
  function doBackdash(f, dir) {
    f.startAction('backdash', 0.32);
    f.vx = dir * 8.5;
    f.evading = true;
    f.evadeUntil = performance.now() + 300;
    f.sideCooldown = Math.max(f.sideCooldown, 0.5);
    spawnHitEffect(f.x, 1.0, f.z, 0x66ffe0, 6);
  }
  function doForwardDash(f, dir) {
    f.startAction('dash', 0.22);
    f.vx = dir * 8.0;
    f.dashCooldown = 0.45;
  }

  /* ------------------------------------------------------------------ *
   *  타격기 변형 선택 (방향 입력에 따라)
   * ------------------------------------------------------------------ */
  function pickPunchVariant(f, opponent) {
    const toward = Math.sign(opponent.x - f.x) || 1;
    if (f.blockHeld) return 'bodyBlow';
    if (f.moveInput !== 0 && f.moveInput === toward) return 'straight';
    if (f.moveInput !== 0 && f.moveInput === -toward) return 'elbow';
    return 'jab';
  }
  function pickKickVariant(f, opponent) {
    const toward = Math.sign(opponent.x - f.x) || 1;
    if (f.blockHeld) return 'sweep';
    if (f.moveInput !== 0 && f.moveInput === toward) return 'roundhouse';
    if (f.moveInput !== 0 && f.moveInput === -toward) return 'spinBack';
    return 'frontKick';
  }

  /* ------------------------------------------------------------------ *
   *  AI (CPU 상대)
   * ------------------------------------------------------------------ */
  const AI_ATTACK_POOL = ['jab', 'jab', 'straight', 'frontKick', 'roundhouse', 'elbow', 'bodyBlow', 'sweep'];

  function updateAI(cpu, player, dt) {
    const ai = cpu.aiState;
    ai.timer -= dt;
    ai.jukeCd -= dt;
    const dx = player.x - cpu.x, dz = player.z - cpu.z;
    const dist = Math.hypot(dx, dz);

    cpu.moveInput = 0;
    cpu.blockHeld = false;

    if (!cpu.canAct()) return;

    if (ai.timer <= 0) {
      ai.timer = 0.22 + Math.random() * 0.35;
      const r = Math.random();
      if (dist > 2.4) {
        ai.decision = 'approach';
      } else if (player.isLocked() && ATTACK_NAMES.includes(player.action) && player.actionT < 0.12 && r < 0.5) {
        ai.decision = r < 0.3 ? 'backdash' : 'block';
      } else if (r < 0.1 && ai.jukeCd <= 0) {
        ai.decision = 'sidestep'; ai.jukeCd = 1.1;
      } else if (r < 0.45) {
        ai.decision = (cpu.meter >= 100 && r < 0.13) ? 'special' : AI_ATTACK_POOL[Math.floor(Math.random() * AI_ATTACK_POOL.length)];
      } else if (r < 0.6) {
        ai.decision = 'retreat';
      } else {
        ai.decision = 'approach';
      }
    }

    switch (ai.decision) {
      case 'approach':
        cpu.moveInput = Math.sign(dx === 0 ? 1 : dx);
        break;
      case 'retreat':
        cpu.moveInput = -Math.sign(dx === 0 ? 1 : dx);
        break;
      case 'block':
        cpu.blockHeld = true;
        break;
      case 'sidestep':
        if (cpu.sideCooldown <= 0) doSidestep(cpu, Math.random() < 0.5 ? -1 : 1);
        ai.decision = 'approach';
        break;
      case 'backdash':
        if (cpu.sideCooldown <= 0) doBackdash(cpu, -Math.sign(dx === 0 ? 1 : dx));
        ai.decision = 'approach';
        break;
      case 'special':
        if (dist < ATTACKS.special.reach + 0.2 && cpu.meter >= 100) { cpu.startAction('special', 0); cpu.meter = 0; }
        ai.decision = 'approach';
        break;
      default: {
        const A = ATTACKS[ai.decision];
        if (A && dist < A.reach + 0.25) cpu.startAction(ai.decision, 0);
        else cpu.moveInput = Math.sign(dx === 0 ? 1 : dx);
        ai.decision = 'approach';
      }
    }
  }

  /* ------------------------------------------------------------------ *
   *  플레이어 입력 -> 의도 반영
   * ------------------------------------------------------------------ */
  function readPlayerInput(f, prefix, opponent) {
    if (!f.canAct()) { f.moveInput = 0; f.blockHeld = false; return; }
    let move = 0;
    let jump = false, block = false, side = 0, dtDirWorld = 0;
    if (prefix === 'p1') {
      if (keys['a']) move -= 1;
      if (keys['d']) move += 1;
      jump = keys['w'];
      block = keys['s'];
      if (consume('q')) side = -1;
      if (consume('e')) side = 1;
      if (consumeDT('a')) dtDirWorld = -1;
      if (consumeDT('d')) dtDirWorld = 1;
      f._punch = consume('f');
      f._kick = consume('g');
      f._special = consume('h');
    } else {
      if (keys['ArrowLeft']) move -= 1;
      if (keys['ArrowRight']) move += 1;
      jump = keys['ArrowUp'];
      block = keys['ArrowDown'];
      if (consume('u')) side = -1;
      if (consume('o')) side = 1;
      if (consumeDT('ArrowLeft')) dtDirWorld = -1;
      if (consumeDT('ArrowRight')) dtDirWorld = 1;
      f._punch = consume('j');
      f._kick = consume('k');
      f._special = consume('l');
    }
    f.moveInput = move;
    f.blockHeld = block;

    if (side !== 0 && f.sideCooldown <= 0) doSidestep(f, side);

    if (dtDirWorld !== 0 && f.canAct()) {
      const towardSign = Math.sign(opponent.x - f.x) || 1;
      if (dtDirWorld === towardSign && f.dashCooldown <= 0) doForwardDash(f, dtDirWorld);
      else if (dtDirWorld === -towardSign && f.sideCooldown <= 0) doBackdash(f, dtDirWorld);
    }

    if (jump && f.grounded && f.action !== 'block' && f.action !== 'crouch') {
      f.vy = JUMP_VSPEED; f.grounded = false; f.startAction('jump', 0);
    }
    if (f._punch && f.canAct()) f.startAction(pickPunchVariant(f, opponent), 0);
    else if (f._kick && f.canAct()) f.startAction(pickKickVariant(f, opponent), 0);
    else if (f._special && f.canAct() && f.meter >= 100) { f.startAction('special', 0); f.meter = 0; }
  }

  function applyMovement(f, dt) {
    if (f.action === 'idle' || f.action === 'walk') {
      if (f.moveInput !== 0) {
        f.x += f.moveInput * MOVE_SPEED * f.style.speed * dt;
        f.action = 'walk';
      } else {
        f.action = 'idle';
      }
    } else if (f.action === 'crouch' || f.action === 'block') {
      // 제자리 유지
    } else if (f.action === 'jump') {
      if (f.moveInput !== 0) f.x += f.moveInput * MOVE_SPEED * 0.7 * f.style.speed * dt;
    }
    if (f.blockHeld && (f.action === 'idle' || f.action === 'walk')) f.action = 'block';
    if (!f.blockHeld && f.action === 'block') f.action = 'idle';
  }

  /* ------------------------------------------------------------------ *
   *  충돌(겹침 방지)
   * ------------------------------------------------------------------ */
  function resolveOverlap(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    if (dist < MIN_SEPARATION && dist > 0.0001) {
      const overlap = (MIN_SEPARATION - dist) / 2;
      const nx = dx / dist, nz = dz / dist;
      a.x -= nx * overlap; a.z -= nz * overlap;
      b.x += nx * overlap; b.z += nz * overlap;
    }
  }

  /* ------------------------------------------------------------------ *
   *  매치 / 라운드 관리
   * ------------------------------------------------------------------ */
  function startMatch() {
    fighters.forEach(f => f && f.dispose());
    fighters = [];
    roundWins = [0, 0];
    roundNumber = 1;
    buildPips();
    startRound();
    matchState = 'fighting';
    setScreen(null);
    document.getElementById('hud').classList.remove('hidden');
    updateSplitUI();
  }

  function buildPips() {
    const p1 = document.getElementById('p1-pips');
    const p2 = document.getElementById('p2-pips');
    p1.innerHTML = ''; p2.innerHTML = '';
    for (let i = 0; i < ROUNDS_TO_WIN; i++) { p1.appendChild(document.createElement('span')); p2.appendChild(document.createElement('span')); }
  }

  function updatePips() {
    const p1 = document.querySelectorAll('#p1-pips span');
    const p2 = document.querySelectorAll('#p2-pips span');
    p1.forEach((s, i) => s.classList.toggle('won', i < roundWins[0]));
    p2.forEach((s, i) => s.classList.toggle('won', i < roundWins[1]));
  }

  function startRound() {
    fighters.forEach(f => f && f.dispose());
    const p1name = STYLES[pickedStyle.p1].name;
    const p2name = STYLES[pickedStyle.p2].name;
    const f1 = new Fighter(pickedStyle.p1, -2.3, Math.PI / 2, p1name, true);
    const f2 = new Fighter(pickedStyle.p2, 2.3, -Math.PI / 2, p2name, false);
    f1._opponentRef = f2; f2._opponentRef = f1;
    fighters = [f1, f2];
    roundTimer = ROUND_TIME;
    document.getElementById('p1-name').textContent = '1P · ' + p1name;
    document.getElementById('p2-name').textContent = (gameMode === '1p' ? 'CPU · ' : '2P · ') + p2name;
    document.getElementById('round-label').textContent = 'ROUND ' + roundNumber;
    updatePips();
    announce('ROUND ' + roundNumber);
    matchState = 'fighting';
  }

  function announce(text) {
    const el = document.getElementById('announce');
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  function endRound(winnerIdx) {
    matchState = 'roundend';
    stateTimer = 2.0;
    if (winnerIdx >= 0) {
      roundWins[winnerIdx]++;
      fighters[winnerIdx].startAction('win', 0);
      announce(winnerIdx === 0 ? (fighters[0].name + ' 승리!') : (fighters[1].name + ' 승리!'));
    } else {
      announce('DRAW');
    }
    updatePips();
  }

  function checkMatchEnd() {
    if (roundWins[0] >= ROUNDS_TO_WIN || roundWins[1] >= ROUNDS_TO_WIN) {
      matchState = 'matchend';
      const winner = roundWins[0] >= ROUNDS_TO_WIN ? 0 : 1;
      document.getElementById('result-title').textContent = 'VICTORY';
      document.getElementById('result-sub').textContent =
        (winner === 0 ? fighters[0].name : fighters[1].name) + (gameMode === '1p' && winner === 1 ? ' (CPU)' : '') + ' 승리! (' + roundWins[0] + ' : ' + roundWins[1] + ')';
      setScreen('menu-result');
      document.getElementById('hud').classList.add('hidden');
      updateSplitUI();
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ *
   *  메인 업데이트 루프
   * ------------------------------------------------------------------ */
  function updateFight(dt) {
    const [p1, p2] = fighters;

    if (keys['Escape']) { keys['Escape'] = false; pauseGame(); return; }

    readPlayerInput(p1, 'p1', p2);
    if (gameMode === '2p') readPlayerInput(p2, 'p2', p1);
    else updateAI(p2, p1, dt);

    applyMovement(p1, dt);
    applyMovement(p2, dt);

    p1.update(dt, p2);
    p2.update(dt, p1);

    resolveOverlap(p1, p2);

    updateParticles(dt);

    document.getElementById('p1-hp').style.width = (p1.hp) + '%';
    document.getElementById('p2-hp').style.width = (p2.hp) + '%';
    document.getElementById('p1-meter').style.width = p1.meter + '%';
    document.getElementById('p2-meter').style.width = p2.meter + '%';

    if (p1.hp <= 0 || p2.hp <= 0) {
      if (p1.hp <= 0 && p2.hp <= 0) endRound(-1);
      else endRound(p1.hp <= 0 ? 1 : 0);
      return;
    }

    roundTimer -= dt;
    if (roundTimer <= 0) {
      roundTimer = 0;
      if (p1.hp === p2.hp) endRound(-1);
      else endRound(p1.hp > p2.hp ? 0 : 1);
    }
    document.getElementById('timer').textContent = Math.ceil(roundTimer);
  }

  function updateRoundEnd(dt) {
    fighters.forEach((f, i) => f.update(dt, fighters[1 - i]));
    updateParticles(dt);
    stateTimer -= dt;
    if (stateTimer <= 0) {
      if (checkMatchEnd()) return;
      roundNumber++;
      startRound();
    }
  }

  /* ------------------------------------------------------------------ *
   *  카메라 — 캐릭터별 3인칭(오버더숄더) + 분할화면
   * ------------------------------------------------------------------ */
  function updateThirdPersonCam(cam, self, other, dt) {
    const camDist = 3.35, camHeight = 1.75;
    const fwdX = Math.sin(self.yaw), fwdZ = Math.cos(self.yaw);
    const desiredX = self.x - fwdX * camDist;
    const desiredZ = self.z - fwdZ * camDist;
    const lerpF = Math.min(1, dt * 5);
    cam.position.x += (desiredX - cam.position.x) * lerpF;
    cam.position.z += (desiredZ - cam.position.z) * lerpF;
    cam.position.y += (camHeight + self.y * 0.4 - cam.position.y) * lerpF;

    const lookX = self.x * 0.38 + other.x * 0.62;
    const lookZ = self.z * 0.38 + other.z * 0.62;
    let shakeX = 0, shakeY = 0;
    if (camShake > 0) { shakeX = (Math.random() - 0.5) * camShake; shakeY = (Math.random() - 0.5) * camShake; }
    cam.lookAt(lookX + shakeX, 1.25 + shakeY, lookZ);
  }

  function updateIdleCam(cam, dt) {
    const t = clock.getElapsedTime();
    cam.position.x = Math.sin(t * 0.1) * 5;
    cam.position.z = 8 + Math.cos(t * 0.1) * 1.5;
    cam.position.y = 3.2;
    cam.lookAt(0, 1, 0);
  }

  function updateCameras(dt) {
    if (fighters.length === 2) {
      const [p1, p2] = fighters;
      updateThirdPersonCam(camera1, p1, p2, dt);
      if (gameMode === '2p') updateThirdPersonCam(camera2, p2, p1, dt);
    } else {
      updateIdleCam(camera1, dt);
    }
    if (camShake > 0) camShake = Math.max(0, camShake - dt * 1.2);
  }

  function splitActive() {
    return gameMode === '2p' && fighters.length === 2 &&
      (matchState === 'fighting' || matchState === 'roundend' || matchState === 'paused');
  }

  function updateSplitUI() {
    const active = splitActive();
    document.getElementById('split-divider').classList.toggle('hidden', !active);
    document.getElementById('p1-viewlabel').classList.toggle('hidden', !active);
    document.getElementById('p2-viewlabel').classList.toggle('hidden', !active);
  }

  function render() {
    const w = window.innerWidth, h = window.innerHeight;
    if (splitActive()) {
      renderer.setScissorTest(true);
      const halfW = Math.floor(w / 2);
      const rightW = w - halfW;

      camera1.aspect = halfW / h; camera1.updateProjectionMatrix();
      renderer.setViewport(0, 0, halfW, h);
      renderer.setScissor(0, 0, halfW, h);
      renderer.render(scene, camera1);

      camera2.aspect = rightW / h; camera2.updateProjectionMatrix();
      renderer.setViewport(halfW, 0, rightW, h);
      renderer.setScissor(halfW, 0, rightW, h);
      renderer.render(scene, camera2);

      renderer.setScissorTest(false);
    } else {
      camera1.aspect = w / h; camera1.updateProjectionMatrix();
      renderer.setViewport(0, 0, w, h);
      renderer.render(scene, camera1);
    }
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(0.033, clock.getDelta());

    if (matchState === 'fighting') updateFight(dt);
    else if (matchState === 'roundend') updateRoundEnd(dt);
    else { updateParticles(dt); }

    updateCameras(dt);
    render();
  }

  /* ------------------------------------------------------------------ *
   *  일시정지
   * ------------------------------------------------------------------ */
  let stateBeforePause = null;
  function pauseGame() {
    if (matchState !== 'fighting') return;
    stateBeforePause = matchState;
    matchState = 'paused';
    setScreen('menu-pause');
  }
  function resumeGame() {
    matchState = stateBeforePause || 'fighting';
    setScreen(null);
  }

  /* ------------------------------------------------------------------ *
   *  화면(메뉴) 전환
   * ------------------------------------------------------------------ */
  function setScreen(id) {
    document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
    if (id) document.getElementById(id).classList.remove('hidden');
  }

  function buildStyleCards(containerId, side) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    Object.values(STYLES).forEach(s => {
      const card = document.createElement('div');
      card.className = 'style-card';
      if (pickedStyle[side] === s.key) card.classList.add('picked');
      card.innerHTML =
        '<div class="s-name">' + s.name + '</div>' +
        '<div class="s-desc">' + s.desc + '</div>' +
        '<div class="s-stats">SPD ' + s.speed.toFixed(2) + ' · PWR ' + s.power.toFixed(2) + ' · 필살: ' + s.specialName + '</div>';
      card.addEventListener('click', () => {
        pickedStyle[side] = s.key;
        container.querySelectorAll('.style-card').forEach(c => c.classList.remove('picked'));
        card.classList.add('picked');
      });
      container.appendChild(card);
    });
  }

  function openSelectScreen() {
    document.getElementById('select-p1-label').textContent = 'Player 1';
    document.getElementById('select-p2-label').textContent = gameMode === '1p' ? 'CPU' : 'Player 2';
    buildStyleCards('p1-styles', 'p1');
    buildStyleCards('p2-styles', 'p2');
    setScreen('menu-select');
  }

  /* ------------------------------------------------------------------ *
   *  버튼 바인딩
   * ------------------------------------------------------------------ */
  function bindUI() {
    document.getElementById('btn-1p').onclick = () => { gameMode = '1p'; openSelectScreen(); };
    document.getElementById('btn-2p').onclick = () => { gameMode = '2p'; openSelectScreen(); };
    document.getElementById('btn-howto').onclick = () => setScreen('menu-howto');
    document.getElementById('btn-howto-back').onclick = () => setScreen('menu-title');
    document.getElementById('btn-select-back').onclick = () => setScreen('menu-title');
    document.getElementById('btn-fight').onclick = () => startMatch();
    document.getElementById('btn-rematch').onclick = () => startMatch();
    document.getElementById('btn-mainmenu').onclick = () => { matchState = 'menu'; setScreen('menu-title'); updateSplitUI(); };
    document.getElementById('btn-resume').onclick = () => resumeGame();
    document.getElementById('btn-quit').onclick = () => {
      matchState = 'menu';
      fighters.forEach(f => f && f.dispose());
      fighters = [];
      document.getElementById('hud').classList.add('hidden');
      setScreen('menu-title');
      updateSplitUI();
    };
  }

  /* ------------------------------------------------------------------ *
   *  부트스트랩
   * ------------------------------------------------------------------ */
  function boot() {
    initScene();
    bindUI();
    setScreen('menu-title');
    updateSplitUI();
    animate();
  }

  window.addEventListener('DOMContentLoaded', boot);
})();
