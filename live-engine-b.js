function genRoom(target){
  const w=8,d=10,h=2.8,area=w*d*2+2*(w*h)+2*(d*h);
  const dens=Math.sqrt(target*.75/area),sp=Math.max(.015,1/dens),sb=sp*.55;
  const P=[],S=[],C=[];
  function push(x,y,z,sx,sy,sz,r,g,b,a=.75){P.push(x,y,z);S.push(sx,sy,sz);C.push(r,g,b,a);}
  function plane(o,u,v,wu,wv,spacing,col,sc){
    const nu=Math.max(2,Math.round(wu/spacing)),nv=Math.max(2,Math.round(wv/spacing));
    for(let i=0;i<=nu;i++)for(let j=0;j<=nv;j++){
      const tu=i/nu-.5,tv=j/nv-.5;
      const x=o[0]+u[0]*tu*wu+v[0]*tv*wv+(hash(i,j)-.5)*spacing*.2;
      const y=o[1]+u[1]*tu*wu+v[1]*tv*wv+(hash(j,i)-.5)*spacing*.15;
      const z=o[2]+u[2]*tu*wu+v[2]*tv*wv+(hash(i*.1,j)-.5)*spacing*.2;
      const c=col(x,y,z),s=.9+hash(x,z)*.2;
      push(x,y,z,sc[0]*s,sc[1]*s,sc[2]*s,c[0],c[1],c[2],c[3]);
    }
  }
  plane([0,.01,0],[1,0,0],[0,0,1],w,d,sp,(x,_,z)=>{const g=.45+.55*Math.sin(x*28+hash(x,z)*3);return[.32+g*.22,.18+g*.12,.09+g*.06,.88];},[sb*1.15,sb*.35,sb*1.15]);
  plane([0,h-.01,0],[1,0,0],[0,0,1],w,d,sp*1.1,()=>[.92,.9,.84,.55],[sb*1.2,sb*.3,sb*1.2]);
  const wc=y=>{const t=Math.max(0,Math.min(1,y/h));return[.78+t*.1,.74+t*.08,.66+t*.06,.78];};
  plane([-w/2+.01,h/2,0],[0,1,0],[0,0,1],h,d,sp,(_,y)=>wc(y),[sb*.3,sb,sb]);
  plane([w/2-.01,h/2,0],[0,1,0],[0,0,1],h,d,sp,(_,y)=>wc(y),[sb*.3,sb,sb]);
  plane([0,h/2,-d/2+.01],[1,0,0],[0,1,0],w,h,sp,(_,y)=>wc(y),[sb,sb,sb*.3]);
  plane([0,h/2,d/2-.01],[1,0,0],[0,1,0],w,h,sp,(_,y)=>wc(y),[sb,sb,sb*.3]);
  plane([0,h*.55,d/2-.03],[1,0,0],[0,1,0],w*.5,h*.5,sp*.65,(x,y)=>{const s=.5+(y/(h*.5))*.4;return[.5+s*.25,.6+s*.2,.4+s*.45,.95];},[sb*.9,sb*.9,sb*.25]);
  plane([1.6,.75,1],[1,0,0],[0,0,1],1.5,.75,sp*.9,()=>[.22,.13,.08,.85],[sb,sb*.3,sb]);
  plane([.3,.025,.4],[1,0,0],[0,0,1],2.6,1.9,sp*.75,()=>[.38,.16,.12,.9],[sb,sb*.25,sb]);
  count=P.length/3;positions=new Float32Array(P);scales=new Float32Array(S);colors=new Float32Array(C);
  eye=[0,1.55,3.5];target=[0,1.15,0];radius=4.5;yaw=.2;pitch=.15;
  document.getElementById("status").textContent="Ready · "+(count/1e3).toFixed(1)+"k gaussians";
  upload();
}
function upload(){
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER,quad);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);gl.vertexAttribDivisor(0,0);
  gl.bindBuffer(gl.ARRAY_BUFFER,bP);gl.bufferData(gl.ARRAY_BUFFER,positions,gl.STATIC_DRAW);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,0,0);gl.vertexAttribDivisor(1,1);
  gl.bindBuffer(gl.ARRAY_BUFFER,bS);gl.bufferData(gl.ARRAY_BUFFER,scales,gl.STATIC_DRAW);gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,3,gl.FLOAT,false,0,0);gl.vertexAttribDivisor(2,1);
  gl.bindBuffer(gl.ARRAY_BUFFER,bC);gl.bufferData(gl.ARRAY_BUFFER,colors,gl.STATIC_DRAW);gl.enableVertexAttribArray(3);gl.vertexAttribPointer(3,4,gl.FLOAT,false,0,0);gl.vertexAttribDivisor(3,1);
}
let last=performance.now(),frames=0,fps=0,fpsT=performance.now();
function frame(now){
  const dt=Math.min(.05,(now-last)/1000);last=now;frames++;
  if(now-fpsT>500){fps=frames*1000/(now-fpsT);frames=0;fpsT=now;}
  if(mode==="orbit"){const cp=Math.cos(pitch),sp=Math.sin(pitch),cy=Math.cos(yaw),sy=Math.sin(yaw);eye[0]=target[0]+radius*sy*cp;eye[1]=target[1]+radius*sp;eye[2]=target[2]+radius*cy*cp;}
  else{const sp=(keys.has("ShiftLeft")?4.5:2)*dt;const fy=-Math.sin(yaw),fz=-Math.cos(yaw),rx=Math.cos(yaw),rz=-Math.sin(yaw);let mx=0,mz=0;if(keys.has("KeyW")){mx+=fy;mz+=fz;}if(keys.has("KeyS")){mx-=fy;mz-=fz;}if(keys.has("KeyD")){mx+=rx;mz+=rz;}if(keys.has("KeyA")){mx-=rx;mz-=rz;}const L=Math.hypot(mx,mz);if(L>0){eye[0]+=mx/L*sp;eye[2]+=mz/L*sp;}if(keys.has("Space"))eye[1]+=sp;if(keys.has("KeyC"))eye[1]-=sp;eye[1]=Math.max(.3,Math.min(5,eye[1]));target[0]=eye[0]-Math.sin(yaw)*Math.cos(pitch);target[1]=eye[1]+Math.sin(pitch);target[2]=eye[2]-Math.cos(yaw)*Math.cos(pitch);}
  lookAt(view,eye,target,[0,1,0]);perspective(proj,55,canvas.width/Math.max(1,canvas.height),.05,200);
  gl.viewport(0,0,canvas.width,canvas.height);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(prog);
  const fy=(.5*canvas.height)/Math.tan(55*Math.PI/360),fx=fy*(canvas.width/Math.max(1,canvas.height));
  gl.uniformMatrix4fv(uV,false,view);gl.uniformMatrix4fv(uP,false,proj);gl.uniform2f(uF,fx,fy);gl.uniform2f(uVp,canvas.width,canvas.height);gl.uniform1f(uM,scaleMul);
  if(count){gl.bindVertexArray(vao);gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,count);}
  document.getElementById("stats").textContent=fps.toFixed(0)+" fps · "+(count/1e3).toFixed(1)+"k gaussians";
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.getElementById("btnRoom500k").onclick=()=>genRoom(500000);
document.getElementById("btnRoom2m").onclick=()=>genRoom(2000000);
document.getElementById("btnRoom5m").onclick=()=>genRoom(3500000);
document.getElementById("btnCampus").onclick=()=>genRoom(3000000);
document.getElementById("btnOrbit").onclick=()=>{mode="orbit";document.getElementById("btnOrbit").classList.add("active");document.getElementById("btnWalk").classList.remove("active");};
document.getElementById("btnWalk").onclick=()=>{mode="walk";document.getElementById("btnWalk").classList.add("active");document.getElementById("btnOrbit").classList.remove("active");};
document.getElementById("scale").oninput=e=>{scaleMul=+e.target.value;document.getElementById("scaleLabel").textContent=(+e.target.value).toFixed(2);};
genRoom(400000);
