const canvas=document.getElementById("c");
const gl=canvas.getContext("webgl2",{antialias:false,alpha:false,premultipliedAlpha:true});
if(!gl){document.getElementById("status").textContent="WebGL2 required";throw 0;}
const dpr=Math.min(devicePixelRatio||1,2);
function resize(){canvas.width=(canvas.clientWidth*dpr)|0;canvas.height=(canvas.clientHeight*dpr)|0;}
resize();addEventListener("resize",resize);
gl.clearColor(0.04,0.04,0.045,1);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.disable(gl.DEPTH_TEST);
const VS=`#version 300 es
precision highp float;
layout(location=0) in vec2 aC;layout(location=1) in vec3 aP;layout(location=2) in vec3 aS;layout(location=3) in vec4 aCol;
uniform mat4 uV,uP;uniform vec2 uF,uVp;uniform float uM;
out vec4 vC;out vec2 vL;
void main(){
  vec4 vp=uV*vec4(aP,1.0);float d=-vp.z;if(d<.05){gl_Position=vec4(0,0,-10,1);vC=vec4(0);vL=aC;return;}
  vec3 s=aS*uM;mat3 cov=mat3(s.x*s.x,0.,0.,0.,s.y*s.y,0.,0.,0.,s.z*s.z);
  float fx=uF.x,fy=uF.y,tx=vp.x,ty=vp.y,tz=d,tz2=tz*tz;
  mat3 J=mat3(fx/tz,0.,-fx*tx/tz2,0.,fy/tz,-fy*ty/tz2,0.,0.,0.);
  mat3 W=mat3(uV);mat3 T=J*W;mat3 c2=T*cov*transpose(T);
  float a=c2[0][0],b=c2[0][1],c=c2[1][1],mid=.5*(a+c),rad=length(vec2(a-c,2.*b))*.5;
  float l1=mid+rad,l2=mid-rad;vec2 e1=normalize(abs(b)>1e-8?vec2(b,l1-a):vec2(1.,0.));vec2 e2=vec2(-e1.y,e1.x);
  float r1=min(sqrt(max(l1,0.))*3.,512.),r2=min(sqrt(max(l2,0.))*3.,512.);
  vec2 sc=aC.x*e1*r1+aC.y*e2*r2;vec4 cl=uP*vp;cl.xy+=sc/uVp*cl.w*2.;gl_Position=cl;vC=aCol;vL=aC;
}`;
const FS=`#version 300 es
precision mediump float;in vec4 vC;in vec2 vL;out vec4 o;
void main(){float r2=dot(vL,vL);if(r2>1.)discard;float g=exp(-2.5*r2);if(g<.015)discard;float a=g*vC.a;o=vec4(vC.rgb*a,a);}`;
function sh(t,s){const x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);if(!gl.getShaderParameter(x,gl.COMPILE_STATUS))throw gl.getShaderInfoLog(x);return x;}
const prog=gl.createProgram();gl.attachShader(prog,sh(gl.VERTEX_SHADER,VS));gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,FS));gl.linkProgram(prog);
const uV=gl.getUniformLocation(prog,"uV"),uP=gl.getUniformLocation(prog,"uP"),uF=gl.getUniformLocation(prog,"uF"),uVp=gl.getUniformLocation(prog,"uVp"),uM=gl.getUniformLocation(prog,"uM");
const quad=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,quad);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
const bP=gl.createBuffer(),bS=gl.createBuffer(),bC=gl.createBuffer();
const vao=gl.createVertexArray();
let positions,scales,colors,count=0,scaleMul=1;
let eye=[0,1.5,4],target=[0,1.2,0],yaw=.3,pitch=.2,radius=5,mode="orbit",drag=false,lx=0,ly=0;
const keys=new Set();
canvas.addEventListener("pointerdown",e=>{drag=true;lx=e.clientX;ly=e.clientY;canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener("pointerup",()=>drag=false);
canvas.addEventListener("pointermove",e=>{if(!drag)return;const dx=e.clientX-lx,dy=e.clientY-ly;lx=e.clientX;ly=e.clientY;if(mode==="orbit"){yaw-=dx*.005;pitch=Math.max(.05,Math.min(1.4,pitch+dy*.005));}else{yaw-=dx*.003;pitch=Math.max(-1.2,Math.min(1.2,pitch-dy*.003));}});
canvas.addEventListener("wheel",e=>{e.preventDefault();if(mode==="orbit")radius=Math.max(.5,Math.min(40,radius*(1+e.deltaY*.001)));},{passive:false});
addEventListener("keydown",e=>keys.add(e.code));addEventListener("keyup",e=>keys.delete(e.code));
function lookAt(out,e,c,up){let zx=e[0]-c[0],zy=e[1]-c[1],zz=e[2]-c[2],l=1/Math.hypot(zx,zy,zz);zx*=l;zy*=l;zz*=l;let xx=up[1]*zz-up[2]*zy,xy=up[2]*zx-up[0]*zz,xz=up[0]*zy-up[1]*zx;l=1/Math.hypot(xx,xy,xz);xx*=l;xy*=l;xz*=l;const yx=zy*xz-zz*xy,yy=zz*xx-zx*xz,yz=zx*xy-zy*xx;out[0]=xx;out[1]=yx;out[2]=zx;out[3]=0;out[4]=xy;out[5]=yy;out[6]=zy;out[7]=0;out[8]=xz;out[9]=yz;out[10]=zz;out[11]=0;out[12]=-(xx*e[0]+xy*e[1]+xz*e[2]);out[13]=-(yx*e[0]+yy*e[1]+yz*e[2]);out[14]=-(zx*e[0]+zy*e[1]+zz*e[2]);out[15]=1;}
function perspective(out,fov,asp,n,f){const t=1/Math.tan(fov*Math.PI/360);out[0]=t/asp;out[1]=0;out[2]=0;out[3]=0;out[4]=0;out[5]=t;out[6]=0;out[7]=0;out[8]=0;out[9]=0;out[10]=(f+n)/(n-f);out[11]=-1;out[12]=0;out[13]=0;out[14]=(2*f*n)/(n-f);out[15]=0;}
const view=new Float32Array(16),proj=new Float32Array(16);
function hash(a,b){const n=Math.sin(a*127.1+b*311.7)*43758.5453;return n-Math.floor(n);}
