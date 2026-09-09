export function coniferGeometry(THREE, variant = 0) {
  const positions = [], colors = [];
  const green = new THREE.Color('#30483d'), shadow = new THREE.Color('#172c27'), snow = new THREE.Color('#d3dedf');
  function triangle(points, color) {
    for (const point of points) { positions.push(...point); colors.push(color.r, color.g, color.b); }
  }
  for (let tier = 0; tier < 6; tier++) {
    const level = .22 + tier * .125;
    const radius = (.25 - tier * .034) * (1 + .07 * Math.sin(tier * 13 + variant));
    const angle = tier * 1.83 + variant * .71;
    const ring = Array.from({ length: 8 }, (_, index) => {
      const direction = angle + index * Math.PI / 4;
      const reach = radius * (index % 2 ? .58 : 1) * (1 + .13 * Math.sin(index * 9 + tier + variant));
      return [Math.cos(direction) * reach, Math.sin(direction) * reach, level - .024 * (index % 2 ? 0 : 1)];
    });
    const tip = [.013 * Math.sin(tier + variant), .008 * Math.cos(tier * 2), level + .19];
    for (let index = 0; index < 8; index++) {
      const loaded = (index + tier * 3 + variant) % 5 === 0;
      const color = green.clone().lerp(snow, loaded ? .87 : .06 + tier * .018);
      triangle([tip, ring[index], ring[(index + 1) % 8]], color);
      triangle([[0, 0, level - .04], ring[(index + 1) % 8], ring[index]], shadow);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function nearConiferGeometry(THREE) {
  const positions = [], colors = [], normals = [], uvs = [];
  const green = new THREE.Color('#46624d'), snow = new THREE.Color('#d3dedf');
  for (let tier = 0; tier < 10; tier++) for (let branch = 0; branch < 9; branch++) for (let plane = 0; plane < 3; plane++) {
    const angle = branch * Math.PI * 2 / 9 + tier * 2.399 + plane*.11;
    const length = (tier===9 ? .14 : .30-tier*.025)*(1+.12*Math.sin(branch*13+tier));
    const root = new THREE.Vector3(0,0,(tier===9 ? .94 : .18+tier*.09)+.022*Math.sin(branch*7+tier*3));
    const forward = new THREE.Vector3(Math.cos(angle),Math.sin(angle),tier === 9 ? 1.7 : -.2 + .23*Math.sin(branch*7+tier+plane)).normalize();
    const across = new THREE.Vector3(-Math.sin(angle),Math.cos(angle),0).applyAxisAngle(forward,(plane-1)*.85);
    const normal = new THREE.Vector3().crossVectors(across,forward).normalize();
    const color = green.clone().lerp(snow,(branch+tier*3)%7===0 && plane===1 ? .82 : .06);
    for (const corner of [[0,0],[1,0],[0,1],[1,0],[1,1],[0,1]]) {
      const point = root.clone().addScaledVector(forward,corner[1]*length).addScaledVector(across,(corner[0]-.5)*length*.95);
      positions.push(point.x,point.y,point.z);normals.push(normal.x,normal.y,normal.z);
      colors.push(color.r,color.g,color.b);uvs.push(...corner);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals,3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors,3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs,2));
  geometry.computeBoundingSphere();
  return geometry;
}

export function needleTexture(THREE) {
  const size=512, pixels=new Uint8Array(size*size*4);
  function stroke(start,end,width,shade) {
    const distance=Math.hypot(end[0]-start[0],end[1]-start[1]);
    const steps=Math.ceil(distance*size*2),radius=width*size;
    for(let step=0;step<=steps;step++){
      const across=(start[0]+(end[0]-start[0])*step/steps)*size;
      const along=(start[1]+(end[1]-start[1])*step/steps)*size;
      for(let row=Math.max(0,Math.floor(along-radius));row<=Math.min(size-1,Math.ceil(along+radius));row++)for(let column=Math.max(0,Math.floor(across-radius));column<=Math.min(size-1,Math.ceil(across+radius));column++){
        const alpha=Math.min(1,Math.max(0,radius+.5-Math.hypot(column-across,row-along)))*255;
        const index=(row*size+column)*4;
        if(alpha>pixels[index+3]){pixels[index]=shade;pixels[index+1]=shade;pixels[index+2]=shade;pixels[index+3]=alpha;}
      }
    }
  }
  stroke([.5,.025],[.5,.97],.005,160);
  for(let twig=0;twig<24;twig++)for(const side of [-1,1]){
    const height=.08+twig*.035,reach=.43*(1-height)**.65;
    const start=[.5,height],end=[.5+side*reach,height+.12];
    stroke(start,end,.003,195);
    for(let needle=0;needle<15;needle++){
      const fraction=(needle+1)/16,across=.5+side*reach*fraction,along=height+.12*fraction;
      const length=.036+.016*Math.sin(twig*13+needle*7)**2;
      stroke([across,along],[across+side*length*.55,along+length],.0022,220+needle%4*8);
      stroke([across,along],[across+side*length*.35,along-length*.8],.002,190+needle%5*10);
    }
  }
  const texture=new THREE.DataTexture(pixels,size,size,THREE.RGBAFormat);
  texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
  texture.needsUpdate=true;return texture;
}

export function addConifers(THREE, scene, trees) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .94 });
  const meshes = [];
  for (let variant = 0; variant < 3; variant++) {
    const selected = trees.filter((tree, index) => index % 3 === variant);
    const mesh = new THREE.InstancedMesh(coniferGeometry(THREE, variant), material, selected.length);
    const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
    selected.forEach((tree, index) => {
      const seed = Math.abs(Math.sin(tree.east * 12.9898 + tree.north * 78.233) * 43758.5453) % 1;
      rotation.setFromAxisAngle(new THREE.Vector3(0, 0, 1), seed * Math.PI * 2);
      const width = tree.size * (.83 + seed * .27);
      matrix.compose(new THREE.Vector3(tree.east, tree.north, tree.height), rotation, new THREE.Vector3(width, width, tree.size));
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, new THREE.Color().setRGB(.83 + seed * .17, .88 + seed * .12, .87 + seed * .13));
    });
    mesh.name = 'aerial-canopy-branched-' + variant;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh); meshes.push(mesh);
  }
  const capacity = Math.min(64, trees.length);
  const nearMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.96,map:needleTexture(THREE),alphaTest:.38,side:THREE.DoubleSide});
  const near = new THREE.InstancedMesh(nearConiferGeometry(THREE), nearMaterial, capacity);
  near.name = 'conifer-near-branches';near.frustumCulled = false;near.castShadow = true;near.receiveShadow = true;
  const saved = meshes.map(mesh => mesh.instanceMatrix.array.slice());
  const inverse = new THREE.Matrix4(), position = new THREE.Vector3(), matrix = new THREE.Matrix4();
  const zero = new THREE.Matrix4().makeScale(0,0,0);
  const color = new THREE.Color();
  for (let index = 0; index < capacity; index++) near.setMatrixAt(index,zero);
  let previous = new THREE.Vector3(Infinity,Infinity,Infinity);
  function updateLOD(camera) {
    scene.updateWorldMatrix(true,false);
    inverse.copy(scene.matrixWorld).invert();position.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inverse);
    if (position.distanceToSquared(previous) < 16) return;
    previous.copy(position);
    const nearest = trees.map((tree,index)=>({index,distance:(tree.east-position.x)**2+(tree.north-position.y)**2}))
      .filter(tree=>tree.distance < 85*85).sort((first,second)=>first.distance-second.distance).slice(0,capacity);
    for (let variant = 0; variant < 3; variant++) meshes[variant].instanceMatrix.array.set(saved[variant]);
    nearest.forEach((entry,index)=>{
      const variant = entry.index % 3, slot = Math.floor(entry.index / 3);
      matrix.fromArray(saved[variant],slot*16);near.setMatrixAt(index,matrix);
      meshes[variant].getColorAt(slot,color);near.setColorAt(index,color);
      meshes[variant].setMatrixAt(slot,zero);
    });
    near.count = nearest.length;near.instanceMatrix.needsUpdate = true;
    if (near.instanceColor) near.instanceColor.needsUpdate = true;
    meshes.forEach(mesh=>{mesh.instanceMatrix.needsUpdate=true;});
  }
  const originalBeforeRender = scene.onBeforeRender;
  scene.onBeforeRender = function(renderer, renderedScene, camera, ...rest) {
    originalBeforeRender?.call(this, renderer, renderedScene, camera, ...rest);
    updateLOD(camera);
  };
  near.onBeforeRender = (renderer, renderedScene, camera) => updateLOD(camera);
  for(const mesh of meshes){mesh.onBeforeRender=near.onBeforeRender;mesh.onBeforeShadow=(renderer,object,camera)=>updateLOD(camera);}
  scene.add(near);
  meshes.near = near;meshes.updateLOD = updateLOD;
  return meshes;
}
