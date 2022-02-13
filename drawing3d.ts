import { DecorationState } from "./DecorationState";
import { DisplayUser, PaintFrameState } from "./drawing-interface";
import { DrawingBase } from "./drawing-shared";
import { RaceState } from "./RaceState";
import THREE from 'three';
import { UserInterface } from "./User";

enum Planes {
  Background = -20,
  CloudLayer = -10,
  RoadFar = -5,
  RacingLane = 0,
  RoadNear = 5,
  CameraClose = 20,
  CameraFast = 70,
}


class DisplayUser3D extends DisplayUser {
  geometry:THREE.BoxGeometry;
  material:THREE.Material;
  cube:THREE.Mesh;
  myUser:UserInterface;


  constructor(user:UserInterface, scene:THREE.Scene) {
    super(user);

    this.geometry = new THREE.BoxGeometry(2,2,0.1);
    this.material = new THREE.MeshPhongMaterial( { 
      color: 0x00ff00,
      opacity: 0.8,
    } );
    this.cube = new THREE.Mesh( this.geometry, this.material );
    this.cube.castShadow = true;
    this.myUser = user;
    scene.add(this.cube);
  }

  update(tmNow:number) {
    this.cube.position.x = this.myUser.getDistance();
    this.cube.position.y = this.myUser.getLastElevation() + 1;
    this.cube.position.z = 0;
  }
}

function buildRoad(raceState:RaceState):THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  // create a simple square shape. We duplicate the top left and bottom right
  // vertices because each vertex needs to appear once per triangle.
  const map = raceState.getMap();

  const startDist = -100;
  const endDist = map.getLength() + 100;
  const stepSize = 10;
  const nPoints = Math.floor((endDist - startDist) / stepSize);
  const floatsPerPoint = 3;
  const pointsPerSegment = 6;
  const verts = new Float32Array(nPoints*floatsPerPoint*pointsPerSegment);
  const norms = new Float32Array(verts.length);
  const colors = new Float32Array(verts.length);
  let ixBase = 0;
  
  const farZ = Planes.RoadFar;
  const nearZ = Planes.RoadNear;

  let ix = 0;
  for(var dist = startDist; dist < endDist; dist += stepSize) {
    ix++;
    const leftIx = ix;
    const rightIx = ix+1;
    const leftX = dist;
    const rightX = dist+stepSize;

    { // triangle based on near side of road, going far-left, near-left, near-right
      verts[ixBase+0] = leftX;
      verts[ixBase+1] = map.getElevationAtDistance(leftX);
      verts[ixBase+2] = nearZ;
      norms[ixBase+0] = 0; norms[ixBase+1] = 1; norms[ixBase+2] = 0;
      colors[ixBase+0] = (leftIx&1); colors[ixBase+1] = (leftIx&2)>>1; colors[ixBase+2] = (leftIx&4)>>2;
      ixBase+=3;
      
      verts[ixBase+0] = rightX;
      verts[ixBase+1] = map.getElevationAtDistance(rightX);
      verts[ixBase+2] = nearZ;
      norms[ixBase+0] = 0; norms[ixBase+1] = 1; norms[ixBase+2] = 0;
      colors[ixBase+0] = (rightIx&1); colors[ixBase+1] = (rightIx&2)>>1; colors[ixBase+2] = (rightIx&4)>>2;
      ixBase+=3;

      verts[ixBase+0] = leftX;
      verts[ixBase+1] = map.getElevationAtDistance(leftX);
      verts[ixBase+2] = farZ;
      norms[ixBase+0] = 0; norms[ixBase+1] = 1; norms[ixBase+2] = 0;
      colors[ixBase+0] = (leftIx&1); colors[ixBase+1] = (leftIx&2)>>1; colors[ixBase+2] = (leftIx&4)>>2;
      ixBase+=3;

    }
    
    { // triangle based on far side of road, going far-left, near-right, far-right
      verts[ixBase+0] = leftX;
      verts[ixBase+1] = map.getElevationAtDistance(leftX);
      verts[ixBase+2] = farZ;
      norms[ixBase+0] = 0; norms[ixBase+1] = 1; norms[ixBase+2] = 0;
      colors[ixBase+0] = (leftIx&1); colors[ixBase+1] = (leftIx&2)>>1; colors[ixBase+2] = (leftIx&4)>>2;
      ixBase+=3;
      
      verts[ixBase+0] = rightX;
      verts[ixBase+1] = map.getElevationAtDistance(rightX);
      verts[ixBase+2] = nearZ;
      norms[ixBase+0] = 0; norms[ixBase+1] = 1; norms[ixBase+2] = 0;
      colors[ixBase+0] = (rightIx&1); colors[ixBase+1] = (rightIx&2)>>1; colors[ixBase+2] = (rightIx&4)>>2;
      ixBase+=3;

      verts[ixBase+0] = rightX;
      verts[ixBase+1] = map.getElevationAtDistance(rightX);
      verts[ixBase+2] = farZ;
      norms[ixBase+0] = 0; norms[ixBase+1] = 1; norms[ixBase+2] = 0;
      colors[ixBase+0] = (rightIx&1); colors[ixBase+1] = (rightIx&2)>>1; colors[ixBase+2] = (rightIx&4)>>2;
      ixBase+=3;

    }
  }
  geometry.setAttribute( 'position', new THREE.BufferAttribute( verts, 3 ) );
  geometry.setAttribute( 'normal', new THREE.BufferAttribute( norms, 3 ) );
  geometry.setAttribute( 'color', new THREE.BufferAttribute( colors, 3 ) );
  const material = new THREE.MeshPhongMaterial( {vertexColors:true} );
  const mesh = new THREE.Mesh( geometry, material );
  mesh.receiveShadow = true;
  return mesh;

  /*const planeGeometry = new THREE.PlaneGeometry( 20, 20, 32, 32 );
  const planeMaterial = new THREE.MeshStandardMaterial( { color: 0x00ff00 } )
  const plane = new THREE.Mesh( planeGeometry, planeMaterial );
  plane.receiveShadow = true;
  return plane;*/
}

export class Drawer3D extends DrawingBase {
    
  scene:THREE.Scene|null = null
  camera:THREE.Camera|null = null;
  renderer:THREE.WebGLRenderer|null = null;


  sunlight:THREE.Light|null = null;

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

      this.sunlight = new THREE.PointLight(0xffffff, 1, 0);
      //this.sunlight.lookAt(0,0,0);
      const bounds = map.getBounds();
      this.sunlight.position.x = map.getLength() / 2;
      this.sunlight.position.y = (bounds.maxElev) + 100;
      this.sunlight.position.z = Planes.RoadNear
      this.sunlight.castShadow = true;
      this.sunlight.shadow.mapSize.width = 512; // default
      this.sunlight.shadow.mapSize.height = 512; // default
      this.sunlight.shadow.camera.near = 0.5; // default
      this.sunlight.shadow.camera.far = 500; // default

      this.scene.add(this.sunlight);

      this.renderer = new THREE.WebGLRenderer({ canvas });
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // default THREE.PCFShadowMap
      
      // let's build the road
      const road = buildRoad(raceState);
      this.scene.add(road);

      this.myRaceState = raceState;
      this.myCanvas = canvas;
    }


  }
  private _trackLocalUser(tmNow:number) {
    if(this.myRaceState && this.camera && this.sunlight) {
      const localUser = this.myRaceState.getLocalUser();
      if(localUser) {
          
        this.sunlight.position.x = localUser.getDistance() - 5;
        this.sunlight.position.y = localUser.getLastElevation() + 2;
        //this.sunlight.position.z = this.myRaceState.getMap().getLength() / 2;
        //this.sunlight.lookAt(localUser.getDistance(), localUser.getLastElevation(), Planes.RacingLane);
        
        this.camera.position.x = localUser.getDistance() + 10;
        this.camera.position.y = localUser.getLastElevation() + 80 + 0.25*Math.sin(tmNow / 500);
        this.camera.position.z = Planes.CameraFast;

        this.camera.lookAt(localUser.getDistance(), localUser.getLastElevation(), 0);
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