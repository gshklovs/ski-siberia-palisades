import { groundZ } from './ground.mjs';
import { RUNS } from './layout.mjs';

const letters={A:['01110','10001','10001','11111','10001','10001','10001'],B:['11110','10001','10001','11110','10001','10001','11110'],C:['01111','10000','10000','10000','10000','10000','01111'],D:['11110','10001','10001','10001','10001','10001','11110'],E:['11111','10000','10000','11110','10000','10000','11111'],F:['11111','10000','10000','11110','10000','10000','10000'],G:['01111','10000','10000','10111','10001','10001','01111'],H:['10001','10001','10001','11111','10001','10001','10001'],I:['11111','00100','00100','00100','00100','00100','11111'],J:['00111','00010','00010','00010','10010','10010','01100'],K:['10001','10010','10100','11000','10100','10010','10001'],L:['10000','10000','10000','10000','10000','10000','11111'],M:['10001','11011','10101','10101','10001','10001','10001'],N:['10001','11001','10101','10011','10001','10001','10001'],O:['01110','10001','10001','10001','10001','10001','01110'],P:['11110','10001','10001','11110','10000','10000','10000'],Q:['01110','10001','10001','10001','10101','10010','01101'],R:['11110','10001','10001','11110','10100','10010','10001'],S:['01111','10000','10000','01110','00001','00001','11110'],T:['11111','00100','00100','00100','00100','00100','00100'],U:['10001','10001','10001','10001','10001','10001','01110'],V:['10001','10001','10001','10001','10001','01010','00100'],W:['10001','10001','10001','10101','10101','10101','01010'],X:['10001','10001','01010','00100','01010','10001','10001'],Y:['10001','10001','01010','00100','00100','00100','00100'],Z:['11111','00001','00010','00100','01000','10000','11111']};
export function signTexture(THREE,text,warning=false){
  const width=256,height=48,data=new Uint8Array(width*height*4);
  const background=warning?[208,169,45]:[26,40,43];
  for(let index=0;index<data.length;index+=4)data.set([...background,255],index);
  const label=text.toUpperCase();const scale=label.length<18?2:1;
  const start=Math.floor((width-label.length*6*scale)/2);
  for(let letter=0;letter<label.length;letter++)for(let row=0;row<7;row++)for(let col=0;col<5;col++)if(letters[label[letter]]?.[row]?.[col]==='1')for(let across=0;across<scale;across++)for(let along=0;along<scale;along++){
    const index=((Math.floor((height-7*scale)/2)+row*scale+along)*width+start+letter*6*scale+col*scale+across)*4;
    data.set(warning?[22,28,26,255]:[242,241,226,255],index);
  }
  const texture=new THREE.DataTexture(data,width,height);texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.NearestFilter;texture.needsUpdate=true;return texture;
}
export function addDetails(THREE,scene,box,materials,surfaceHeight=groundZ,{trackExclusionBounds=[]}={}){
  const {timber,dark,red,steel}=materials;
  for(const run of RUNS.filter(run=>run.sign)){
    const point=run.pts[0],east=point[0]+8,north=point[1]+3,height=surfaceHeight(east,north);
    const title=run.name==='North Bowl'?'NOT GROOMED':run.name==='Sun Bowl'?'CAUTION':run.name==='Siberia Bowl'?'MOST DIFFICULT':run.name;
    const board=new THREE.Mesh(new THREE.PlaneGeometry(1.6,.48),new THREE.MeshStandardMaterial({map:signTexture(THREE,title,true),side:THREE.DoubleSide,roughness:1}));
    board.rotation.x=Math.PI/2;board.position.set(east,north-.046,height+2.2);board.name='printed-trail-board';scene.add(board);
    if(run.name==='Sun Bowl'||run.name==='North Bowl'){
      for(let index=0;index<7;index++){
        const poleEast=east+index*3.5,poleNorth=north+4,poleHeight=surfaceHeight(poleEast,poleNorth);
        box('boundary-bamboo',[poleEast,poleNorth,poleHeight+.8],[.045,.045,1.6],red,true);
        if(index<6){
          const nextHeight=surfaceHeight(poleEast+3.5,poleNorth)+.8;
          const cord=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(poleEast,poleNorth,poleHeight+.8),new THREE.Vector3(poleEast+3.5,poleNorth,nextHeight)]),new THREE.LineBasicMaterial({color:'#b23d26'}));
          cord.name='boundary-safety-cord';scene.add(cord);
        }
      }
    }
  }
  const suits=[new THREE.MeshStandardMaterial({color:'#b84733',roughness:1}),new THREE.MeshStandardMaterial({color:'#568993',roughness:1}),new THREE.MeshStandardMaterial({color:'#d9ad50',roughness:1})];
  function person(east,north,index){
    const height=surfaceHeight(east,north),suit=suits[index%suits.length];
    box('skier-torso',[east,north,height+1.12],[.44,.25,.62],suit);
    box('skier-helmet',[east,north,height+1.57],[.25,.26,.27],dark);
    for(const side of [-1,1]){
      box('skier-leg',[east+side*.12,north,height+.46],[.13,.17,.65],dark);
      box('skier-arm',[east+side*.29,north,height+.99],[.12,.14,.52],suit);
      box('skier-ski',[east+side*.14,north,height+.04],[.10,1.7,.05],steel,false);
    }
  }
  for(let index=0;index<8;index++){
    const east=-280+index*6;
    let crestNorth=-420,crestHeight=-Infinity;
    for(let north=-440;north<-300;north+=2)if(surfaceHeight(east,north)>crestHeight){crestHeight=surfaceHeight(east,north);crestNorth=north;}
    person(east,crestNorth,index);
  }
  const top=RUNS.find(run=>run.name==='Siberia Bowl').pts[0];
  for(let index=0;index<6;index++)person(top[0]-8-index*2,top[1]+12,index);
  const positions=[];
  for(const run of RUNS.filter(run=>['Siberia Bowl','Sun Bowl','North Bowl','Main Chute','Extra Chute'].includes(run.name)))for(let track=0;track<5;track++)for(let segment=0;segment<run.pts.length-1;segment++){
    const first=run.pts[segment],second=run.pts[segment+1];
    const length=Math.hypot(second[0]-first[0],second[1]-first[1]);
    const normal=[-(second[1]-first[1])/length,(second[0]-first[0])/length];
    const steps=Math.max(1,Math.ceil(length/2));
    for(let part=0;part<steps;part++)for(const skiSide of [-.18,.18]){
      const corners=[];
      for(const fraction of [part/steps,(part+1)/steps]){
        const offset=(track-2)*3+Math.sin((segment+fraction)*.7+track)*2+skiSide;
        for(const edge of [-.025,.025]){
          const east=first[0]+(second[0]-first[0])*fraction+normal[0]*(offset+edge);
          const north=first[1]+(second[1]-first[1])*fraction+normal[1]*(offset+edge);
          corners.push([east,north,surfaceHeight(east,north)+.035]);
        }
      }
      for(const triangle of [[0,1,2],[1,3,2]]){
        const points=triangle.map(index=>corners[index]);
        const bounds=[Math.min(...points.map(point=>point[0])),Math.min(...points.map(point=>point[1])),Math.max(...points.map(point=>point[0])),Math.max(...points.map(point=>point[1]))];
        if(trackExclusionBounds.some(exclusion=>bounds[0]<=exclusion[2]&&bounds[2]>=exclusion[0]&&bounds[1]<=exclusion[3]&&bounds[3]>=exclusion[1]))continue;
        for(const index of triangle)positions.push(...corners[index]);
      }
    }
  }
  const trackGeometry=new THREE.BufferGeometry();trackGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  const tracks=new THREE.Mesh(trackGeometry,new THREE.MeshBasicMaterial({color:'#607d9a',transparent:true,opacity:.10,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1}));tracks.name='settled-ski-tracks';scene.add(tracks);
}
