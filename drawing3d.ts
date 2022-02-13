import { DecorationState } from "./DecorationState";
import { DisplayUser, PaintFrameState, RGB } from "./drawing-interface";
import { DrawingBase } from "./drawing-shared";
import { RaceState } from "./RaceState";
import THREE, { Plane } from 'three';
import { UserInterface } from "./User";
import { RideMap } from "./RideMap";

enum Planes {
  Background = -40,
  CloudLayer = -35,
  RoadFar = -5,
  RacingLane = 2.5,
  RoadNear = 5,
  CameraClose = 10,
  CameraFast = 40,
}

const VIS_ELEV_SCALE = 6.5;
function getVisElev(map:RideMap, dist:number) {
  return VIS_ELEV_SCALE*map.getElevationAtDistance(dist);
}

class DisplayUser3D extends DisplayUser {
  geometry:THREE.BoxGeometry;
  material:THREE.Material;
  cube:THREE.Mesh;
  myUser:UserInterface;
  myScene:THREE.Scene;


  constructor(user:UserInterface, scene:THREE.Scene) {
    super(user);

    this.geometry = new THREE.BoxGeometry(0.1,2,2);
    this.material = new THREE.MeshPhongMaterial( { 
      color: 0x00ff00,
      opacity: 0.8,
    } );
    this.cube = new THREE.Mesh( this.geometry, this.material );
    this.cube.castShadow = true;
    this.myUser = user;
    this.myScene = scene;
    scene.add(this.cube);
  }

  update(tmNow:number) {
    this.cube.position.x = this.myUser.getDistance();
    this.cube.position.y = VIS_ELEV_SCALE*this.myUser.getLastElevation() + 1;
    this.cube.position.z = Planes.RacingLane;

    const slopePercent = this.myUser.getLastSlopeInWholePercent();
    const slopeMath = slopePercent / 100;
    const visSlopeMath = slopeMath * VIS_ELEV_SCALE;
    // so if we're have slope 0.2 (rise 0.2, run 1), then our up-vector will be (rise 1, run -0.2)
    const upVector = new THREE.Vector3(-visSlopeMath, 1, 0);
    const lookAt = upVector.add(this.cube.position);
    //this.cube.lookAt(lookAt);
    this.cube.lookAt(lookAt);

  }
}

function buildSquareMesh(map:RideMap, nearZ:number, farZ:number, stepSize:number, material:THREE.Material, fnColor:(dist:number)=>RGB, fnHeights?:(dist:number)=>{near:number,far:number}):THREE.Mesh {

  if(!fnHeights) {
    fnHeights = (dist:number)=> {
      const e = getVisElev(map, dist);
      return {near:e,far:e};
    }
  }

  const geometry = new THREE.BufferGeometry();
  // create a simple square shape. We duplicate the top left and bottom right
  // vertices because each vertex needs to appear once per triangle.

  const startDist = -500;
  const endDist = map.getLength() + 100;
  const nPoints = Math.floor((endDist - startDist) / stepSize);
  const floatsPerPoint = 3;
  const floatsPerUv = 2;
  const pointsPerSegment = 6;
  const verts = new Float32Array(nPoints*floatsPerPoint*pointsPerSegment);
  const norms = new Float32Array(verts.length);
  const colors = new Float32Array(verts.length);
  const uv = new Float32Array(nPoints * pointsPerSegment * floatsPerUv);
  let ixBase = 0;
  let ixUvBase = 0;
  
  const uLeft = 0;
  const uRight =  1;
  const vNear = 0;
  const vFar = 0;

  let ix = 0;
  for(var dist = startDist; dist < endDist; dist += stepSize) {
    ix++;
    const leftX = dist;
    const rightX = dist+stepSize;
    const elevsLeft = fnHeights(dist);
    const elevsRight = fnHeights(dist+stepSize);

    const colorLeft = fnColor(dist);
    const colorRight = fnColor(dist+stepSize);

    { // triangle based on near side of road, going far-left, near-left, near-right
      verts[ixBase+0] = leftX;
      verts[ixBase+1] = elevsLeft.near
      verts[ixBase+2] = nearZ;
      norms[ixBase+0] = 0; norms[ixBase+1] = 1; norms[ixBase+2] = 0;
      colors[ixBase+0] = colorLeft.r; colors[ixBase+1] = colorLeft.g; colors[ixBase+2] = colorLeft.b;
      uv[ixUvBase+0] = 0; 
      uv[ixUvBase+1] = 1;
      ixBase+=3;  ixUvBase += 2;
      
      verts[ixBase+0] = rightX;
      verts[ixBase+1] = elevsRight.near
      verts[ixBase+2] = nearZ;
      norms[ixBase+0] = 0; norms[ixBase+1] = 1; norms[ixBase+2] = 0;
      colors[ixBase+0] = colorRight.r; colors[ixBase+1] = colorRight.g; colors[ixBase+2] = colorRight.b;
      uv[ixUvBase+0] = 1; 
      uv[ixUvBase+1] = 1;
      ixBase+=3;  ixUvBase += 2;

      verts[ixBase+0] = leftX;
      verts[ixBase+1] = elevsLeft.far
      verts[ixBase+2] = farZ;
      norms[ixBase+0] = 0; norms[ixBase+1] = 1; norms[ixBase+2] = 0;
      colors[ixBase+0] = colorLeft.r; colors[ixBase+1] = colorLeft.g; colors[ixBase+2] = colorLeft.b;
      uv[ixUvBase+0] = uLeft; 
      uv[ixUvBase+1] = vFar;
      ixBase+=3;  ixUvBase += 2;

    }
    
    { // triangle based on far side of road, going far-left, near-right, far-right
      verts[ixBase+0] = leftX;
      verts[ixBase+1] = elevsLeft.far
      verts[ixBase+2] = farZ;
      norms[ixBase+0] = 0; norms[ixBase+1] = 1; norms[ixBase+2] = 0;
      colors[ixBase+0] = colorLeft.r; colors[ixBase+1] = colorLeft.g; colors[ixBase+2] = colorLeft.b;
      uv[ixUvBase+0] = 0; 
      uv[ixUvBase+1] = 0;
      ixBase+=3;  ixUvBase += 2;
      
      verts[ixBase+0] = rightX;
      verts[ixBase+1] = elevsRight.near
      verts[ixBase+2] = nearZ;
      norms[ixBase+0] = 0; norms[ixBase+1] = 1; norms[ixBase+2] = 0;
      colors[ixBase+0] = colorRight.r; colors[ixBase+1] = colorRight.g; colors[ixBase+2] = colorRight.b;
      uv[ixUvBase+0] = 1; 
      uv[ixUvBase+1] = 1;
      ixBase+=3;  ixUvBase += 2;

      verts[ixBase+0] = rightX;
      verts[ixBase+1] = elevsRight.far
      verts[ixBase+2] = farZ;
      norms[ixBase+0] = 0; norms[ixBase+1] = 1; norms[ixBase+2] = 0;
      colors[ixBase+0] = colorRight.r; colors[ixBase+1] = colorRight.g; colors[ixBase+2] = colorRight.b;
      uv[ixUvBase+0] = 1; 
      uv[ixUvBase+1] = 0;
      ixBase+=3;  ixUvBase += 2;

    }
  }
  geometry.setAttribute( 'position', new THREE.BufferAttribute( verts, 3 ) );
  geometry.setAttribute( 'normal', new THREE.BufferAttribute( norms, 3 ) );
  geometry.setAttribute( 'color', new THREE.BufferAttribute( colors, 3 ) );
  geometry.setAttribute( 'uv', new THREE.BufferAttribute( uv, 2 ) );
  const mesh = new THREE.Mesh( geometry, material );
  mesh.receiveShadow = true;
  return mesh;
}


function buildRoad(raceState:RaceState):THREE.Mesh[] {
  const map = raceState.getMap();
  const stepSize = 10;

  const fnRoadColor = (dist:number) => {
    let r = (Math.sin(dist / 250) + 1) / 2;
    r *= 0.2;
    return {
      r: 0.35 + r,
      g: 0.35 + r,
      b: 0.35 + r,
    }
  }

  const roadTexture = new THREE.TextureLoader().load( "/road.jpg" );
  const roadMaterial = new THREE.MeshPhongMaterial( {vertexColors:true} );
  roadMaterial.map = roadTexture;
  const roadMesh = buildSquareMesh(map, Planes.RoadNear, Planes.RoadFar, stepSize, roadMaterial, fnRoadColor);

  const grassTexture = new THREE.TextureLoader().load( "/grass.jpg" );
  grassTexture.wrapS = THREE.RepeatWrapping;
  grassTexture.wrapT = THREE.RepeatWrapping;
  grassTexture.repeat.set( 4, 4 );
  const fnGrassColor = (dist:number) => {
    let r = (Math.sin(dist / 168) + 1) / 2;
    return {r:0.6, 
            g:0.8,
            b:0.6
          }
  }
  const backGrassMaterial = new THREE.MeshPhongMaterial({vertexColors:true});
  backGrassMaterial.map = grassTexture;
  const farGrassMesh = buildSquareMesh(map, Planes.RoadFar, Planes.Background, stepSize, backGrassMaterial, fnGrassColor);
  const nearGrassMesh = buildSquareMesh(map, Planes.CameraFast, Planes.RoadNear, stepSize, backGrassMaterial, fnGrassColor);


  const fnSkyColor = (dist:number) => {
    return {r:0, 
            g:0,
            b:1
          }
  }
  const fnSkyHeight = (dist:number) => {
    return {
      near: getVisElev(map, dist),
      far: VIS_ELEV_SCALE*map.getBounds().maxElev + VIS_ELEV_SCALE*10,
    }
  }
  const skyMaterial = new THREE.MeshStandardMaterial({color: 0x35D6ed});
  const skyMesh = buildSquareMesh(map, Planes.Background, Planes.Background, stepSize, skyMaterial, fnSkyColor, fnSkyHeight);

  return [roadMesh, farGrassMesh, skyMesh, nearGrassMesh]
}

export class Drawer3D extends DrawingBase {
    
  scene:THREE.Scene|null = null
  camera:THREE.Camera|null = null;
  renderer:THREE.WebGLRenderer|null = null;

  lights = {
    sunlight:null as THREE.Light|null,
    ambient:null as THREE.AmbientLight|null,
  };

  myRaceState:RaceState|null = null;
  myCanvas:HTMLCanvasElement|null = null;

  constructor() {
    super();
  }
  private _build(canvas:HTMLCanvasElement, raceState:RaceState) {

    if(raceState !== this.myRaceState || canvas !== this.myCanvas) {
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );

      //const light = new THREE.AmbientLight( 0x404040 ); // soft white light
      //this.scene.add( light );
      const map = raceState.getMap();

      this.lights.ambient = new THREE.AmbientLight(0xc0c0c0);
      this.scene.add(this.lights.ambient);

      this.lights.sunlight = new THREE.PointLight(0xffffff, 2.5, 0);
      //this.sunlight.lookAt(0,0,0);
      const bounds = map.getBounds();
      this.lights.sunlight.position.x = map.getLength() / 2;
      this.lights.sunlight.position.y = (bounds.maxElev) + 100;
      this.lights.sunlight.position.z = Planes.CameraFast
      this.lights.sunlight.castShadow = true;
      this.lights.sunlight.shadow.mapSize.width = Math.max(window.innerWidth, window.innerHeight); // default
      this.lights.sunlight.shadow.mapSize.height = Math.max(window.innerWidth, window.innerHeight); // default
      this.lights.sunlight.shadow.camera.near = this.lights.sunlight.position.z - Planes.RacingLane; // default
      this.lights.sunlight.shadow.camera.far = map.getLength(); // this appears to control the radius that the LIGHT functions as well as shadows.  so it needs to be the entire radius that we want the light to do

      this.scene.add(this.lights.sunlight);

      this.renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // default THREE.PCFShadowMap
      
      // let's build the road
      const road = buildRoad(raceState);
      this.scene.add(...road);

      this.myRaceState = raceState;
      this.myCanvas = canvas;
    }


  }
  private _trackLocalUser(tmNow:number) {
    if(this.myRaceState && this.camera && this.lights.sunlight) {
      const localUser = this.myRaceState.getLocalUser();
      const map = this.myRaceState.getMap();
      if(localUser) {
        const s = tmNow / 1000;

        // we want the shadow-casting light to change where the shadow gets cast depending on how far they are along in the race
        const pct = localUser.getDistance() / this.myRaceState.getMap().getLength();
        const shiftage = 60;
        this.lights.sunlight.position.x = localUser.getDistance() - shiftage / 2 + shiftage*pct;
        this.lights.sunlight.position.y = getVisElev(map, localUser.getDistance()) + Planes.CameraFast;
        //this.sunlight.position.z = this.myRaceState.getMap().getLength() / 2;
        //this.sunlight.lookAt(localUser.getDistance(), localUser.getLastElevation(), Planes.RacingLane);
        
        this.camera.position.x = localUser.getDistance() + 1;
        this.camera.position.y = getVisElev(map, localUser.getDistance()) + Planes.CameraFast/2;
        this.camera.position.z = Planes.CameraFast;

        this.camera.lookAt(localUser.getDistance(), VIS_ELEV_SCALE*localUser.getLastElevation(), 0);
      }
      
    }
    
  }
  paintCanvasFrame(canvas:HTMLCanvasElement, raceState:RaceState, timeMs:number, decorationState:DecorationState, dt:number, paintState:PaintFrameState):void {

    const tmNow = new Date().getTime();

    this._build(canvas, raceState);
    this._trackLocalUser(tmNow);
    
    const seconds = Math.sin(timeMs / 1000);

    if(this.camera && this.renderer && this.scene) {
      this.renderer.render( this.scene, this.camera );
    }
  }
  doPaintFrameStateUpdates(rootResourceUrl:string, tmNow:number, dtSeconds:number, raceState:RaceState, paintState:PaintFrameState) {
    if(this.scene) {
      const users = raceState.getUserProvider().getUsers(tmNow)
      for(var user of users) {
        const ps:DisplayUser3D = (paintState.userPaint.get(user.getId()) as DisplayUser3D) || new DisplayUser3D(user, this.scene);
        ps.update(tmNow)

        paintState.userPaint.set(user.getId(), ps);
      }
    }
  }

}