import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, type VRM } from '@pixiv/three-vrm';
import { channels, restPose, type Pose } from './model.ts';
import { applyPose } from './rig.ts';
import { blinkWeight, emptyExpression, expressionNames, type ExpressionWeights } from './expression.ts';
type Trajectory = { axis: string; poses: Pose[]; knots: Pose[]; select: (index: number) => void; move: (index: number, delta: number, commit: boolean) => void };

export class Viewer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, .05, 50);
  readonly renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  readonly controls: OrbitControls;
  vrm: VRM | null = null;
  private pose: Pose = restPose();
  private path = new THREE.Group();
  private room = new THREE.Group();
  private grid: THREE.GridHelper;
  private pathData: Trajectory | null = null;
  private face=emptyExpression();
  private faceTime=0;
  private palms=new THREE.Group();
  private palmArrows:THREE.ArrowHelper[]=[];
  blinking=true;
  constructor(container: HTMLElement, status: HTMLElement) {
    this.scene.background = new THREE.Color('#29272b');
    this.camera.position.set(1.8, 1.3, 3.2);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.append(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, .75, 0); this.controls.enableDamping = true;
    this.controls.minDistance = 1; this.controls.maxDistance = 7;
    this.scene.add(new THREE.HemisphereLight('#eef5ff', '#778297', 1.4));
    const key = new THREE.DirectionalLight('#fff4e4', 1.8); key.position.set(2, 4, 4); this.scene.add(key);
    const fill = new THREE.DirectionalLight('#9ecbff', .8); fill.position.set(-3, 2, -1); this.scene.add(fill);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(5, 80), new THREE.MeshStandardMaterial({ color: '#393330', roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.01; this.scene.add(floor);
    const grid = this.grid = new THREE.GridHelper(6, 24, '#65554a', '#413b38'); grid.position.y = -.005; this.scene.add(grid);
    this.scene.add(this.path, this.room);
    for(const color of ['#e6b568','#e97852']) {
      const arrow=new THREE.ArrowHelper(new THREE.Vector3(0,1,0),new THREE.Vector3(),.17,color,.035,.018);
      for(const object of [arrow.line,arrow.cone]){for(const material of Array.isArray(object.material)?object.material:[object.material])material.depthTest=false;object.renderOrder=20;}
      this.palms.add(arrow);this.palmArrows.push(arrow);
    }
    this.palms.visible=false;this.scene.add(this.palms);
    const box = (x: number, y: number, z: number, w: number, h: number, d: number, color: string) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: .85 })); mesh.position.set(x,y,z); this.room.add(mesh); };
    box(0,1.5,-1.8,8,3,.1,'#39302d');
    for (let i = 0; i < 5; i++) { const x = -2.5 + i * 1.25; box(x,1.4,-1.65,.035,2.8,.12,'#564539'); }
    for (const y of [.5,1.05,1.6,2.15]) { box(-.9,y,-1.4,.7,.045,.4,'#4a3830'); for(let i=0;i<6;i++) box(-1.18+i*.1,y+.17,-1.43,.065,.24+(i%3)*.04,.18,['#796650','#554b45','#977957'][i%3]); }
    box(.85,.55,-.9,.62,.055,.62,'#4f3a30'); box(.85,.3,-.9,.06,.55,.06,'#594335');
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(.18,.27,.33,40), new THREE.MeshStandardMaterial({ color:'#e6bd8c', emissive:'#e6a861', emissiveIntensity:.55 })); lamp.position.set(.85,1.18,-.9); this.room.add(lamp);
    box(.85,.84,-.9,.025,.55,.025,'#c39e70');
    const glow = new THREE.PointLight('#ffc789',1.2,4); glow.position.set(.85,1.2,-.7); this.room.add(glow);
    this.mode('chat');
    const canvas = this.renderer.domElement, ray = new THREE.Raycaster();
    let drag: { index: number; x: number; y: number; dx: number; dy: number; data: Trajectory; delta: number } | null = null;
    canvas.addEventListener('pointerdown', event => {
      if (!this.pathData || !this.vrm || event.button !== 0) return;
      const rect = canvas.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1, 1-(event.clientY-rect.top)/rect.height*2), this.camera);
      const hit = ray.intersectObjects(this.path.children).find(h => h.object.userData.index !== undefined); if (!hit) return;
      event.stopImmediatePropagation(); const index = hit.object.userData.index as number, data = this.pathData, pose = structuredClone(data.knots[index]);
      const a = this.position(pose, data.axis).project(this.camera); pose[data.axis].p += .02;
      const b = this.position(pose, data.axis).project(this.camera);
      drag = { index, x:event.clientX, y:event.clientY, dx:(b.x-a.x)*rect.width/2/.02, dy:-(b.y-a.y)*rect.height/2/.02, data, delta:0 };
      this.controls.enabled = false; canvas.setPointerCapture(event.pointerId); data.select(index);
    }, true);
    canvas.addEventListener('pointermove', event => { if (!drag) return; const d = drag, length = d.dx*d.dx+d.dy*d.dy; d.delta = length > 25 ? ((event.clientX-d.x)*d.dx+(event.clientY-d.y)*d.dy)/length : (d.y-event.clientY)*.005; d.data.move(d.index, d.delta, false); });
    const end = () => { if (drag) drag.data.move(drag.index,drag.delta,true); drag = null; this.controls.enabled = true; };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', () => { if (drag) drag.data.move(drag.index,0,false); drag = null; this.controls.enabled = true; });
    new ResizeObserver(() => { const { width, height } = container.getBoundingClientRect(); this.renderer.setSize(width, height); this.camera.aspect = width / Math.max(1, height); this.camera.updateProjectionMatrix(); }).observe(container);
    const loader = new GLTFLoader(); loader.register(parser => new VRMLoaderPlugin(parser));
    void loader.loadAsync('/model.vrm').then(gltf => {
      const vrm = gltf.userData.vrm as VRM | undefined;
      if (!vrm || vrm.meta.metaVersion !== '1') throw new Error('VRM 1.0 is required');
      const missing = [...new Set(Object.keys(channels).map(c => c.split('.')[0]))].filter(name => !vrm.humanoid.getNormalizedBoneNode(name as Parameters<VRM['humanoid']['getNormalizedBoneNode']>[0]));
      if (missing.length) throw new Error(`Missing bones: ${missing.join(', ')}`);
      this.vrm = vrm; vrm.humanoid.resetNormalizedPose();
      if (vrm.lookAt) vrm.lookAt.autoUpdate = false;
      vrm.scene.traverse((object: THREE.Object3D) => { if ((object as THREE.Mesh).isMesh) object.frustumCulled = false; });
      const missingExpressions=expressionNames.filter(name=>!vrm.expressionManager?.getExpression(name));
      if(missingExpressions.length)throw new Error('Missing expressions: '+missingExpressions.join(', '));
      this.scene.add(vrm.scene); status.textContent = 'AvatarSample Y · VRM 1.0'; status.dataset.loaded = 'true';
    }).catch(e => { status.textContent = `モデル読込失敗: ${e.message}`; status.dataset.loaded = 'false'; });
  }
  setPose(pose: Pose) { this.pose = pose; }
  setExpression(weights:ExpressionWeights,time:number) {this.face=weights;this.faceTime=time;}
  showPalms(show:boolean){this.palms.visible=show;}
  mode(mode: 'chat' | 'motion') {
    this.grid.visible = mode === 'motion'; this.room.visible = mode === 'chat';
    if (mode === 'chat') { this.camera.position.set(0,1.3,2.0); this.controls.target.set(0,1.1,0); this.trajectory(null);this.showPalms(false); }
    else this.view('front');
    this.controls.update();
  }
  private position(pose: Pose, axis: string) {
    if (!this.vrm) return new THREE.Vector3();
    applyPose(name => this.vrm!.humanoid.getNormalizedBoneNode(name as Parameters<VRM['humanoid']['getNormalizedBoneNode']>[0]), pose);
    this.vrm.update(0); this.vrm.scene.updateMatrixWorld(true);
    const bone = axis.startsWith('left') ? 'leftHand' : axis.startsWith('right') ? 'rightHand' : 'head';
    const node = this.vrm.humanoid.getNormalizedBoneNode(bone);
    // Offset the wrist so hand rotation also has a visible trajectory.
    return node ? node.localToWorld(new THREE.Vector3(bone === 'leftHand' ? .08 : bone === 'rightHand' ? -.08 : 0, bone === 'head' ? .12 : 0, bone === 'head' ? .07 : 0)) : new THREE.Vector3();
  }
  trajectory(data: Trajectory | null) {
    this.pathData = data;
    for (const child of [...this.path.children]) { const mesh = child as THREE.Mesh; mesh.geometry?.dispose(); if (mesh.material) (mesh.material as THREE.Material).dispose(); this.path.remove(child); }
    if (!data || !this.vrm) return;
    const points = data.poses.map(p => this.position(p, data.axis));
    this.path.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:'#e6b568',depthTest:false,transparent:true,opacity:.9})));
    data.knots.forEach((p,index) => { const dot = new THREE.Mesh(new THREE.SphereGeometry(.018,12,8),new THREE.MeshBasicMaterial({color:'#e97852',depthTest:false})); dot.position.copy(this.position(p,data.axis)); dot.userData.index=index; dot.renderOrder=10; this.path.add(dot); });
    applyPose(name => this.vrm!.humanoid.getNormalizedBoneNode(name as Parameters<VRM['humanoid']['getNormalizedBoneNode']>[0]),this.pose); this.vrm.update(0);
  }
  view(side: 'front' | 'side' | 'angle' | 'upper') {
    if(side==='upper'){this.camera.position.set(0,1.3,2.0);this.controls.target.set(0,1.18,0);this.controls.update();return;}
    this.camera.position.set(...(side === 'front' ? [0, 1.1, 3.5] : side === 'side' ? [3.5, 1.1, 0] : [1.8, 1.3, 3.2]) as [number, number, number]);
    this.controls.target.set(0, .75, 0); this.controls.update();
  }
  render(dt: number) {
    if (this.vrm) {
      applyPose(name => this.vrm!.humanoid.getNormalizedBoneNode(name as Parameters<VRM['humanoid']['getNormalizedBoneNode']>[0]), this.pose);
      const expressions=this.vrm.expressionManager;
      for(const [name,weight] of Object.entries(this.face))expressions?.setValue(name,weight);
      expressions?.setValue('neutral',Math.max(0,1-Object.values(this.face).reduce((sum,w)=>sum+w,0)));
      expressions?.setValue('blink',this.blinking?blinkWeight(this.faceTime,this.face):0);
      this.vrm.update(dt);
      if(this.palms.visible){
        this.vrm.scene.updateMatrixWorld(true);
        const point=(name:string)=>this.vrm!.humanoid.getRawBoneNode(name as Parameters<VRM['humanoid']['getRawBoneNode']>[0])!.getWorldPosition(new THREE.Vector3());
        for(const [i,side] of ['right','left'].entries()){
          const wrist=point(side+'Hand'),middle=point(side+'MiddleProximal'),index=point(side+'IndexProximal'),little=point(side+'LittleProximal');
          const normal=index.sub(little).cross(middle.clone().sub(wrist)).normalize().multiplyScalar(side==='right'?1:-1);
          this.palmArrows[i].position.copy(wrist.lerp(middle,.65));this.palmArrows[i].setDirection(normal);
        }
      }
    }
    this.controls.update(); this.renderer.render(this.scene, this.camera);
  }
}
