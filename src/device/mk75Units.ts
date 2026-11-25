/**
 * Key-group ("unit") files shipped with the official MK75 driver (Dev/kb/MK75/Cartoon/*.txt, ET/*.txt).
 * The vendor animates live effects across these groups in order. Each line is one group; a line may
 * end with ":R,G,B" giving that group's colour (others are interpolated). Columns separated by ':'
 * (audiobar/happy) are stacked segments, bottom to top.
 */
import { MK75_KEYS } from './mk75Layout';

const NAME_TO_LABEL: Record<string, string> = {
  esc: 'Esc', '~': '`', tab: 'Tab', caps: 'CapsLock', shift: 'LShift', ctrl: 'LCtrl', win: 'LWin', alt: 'LAlt',
  space: 'Space', ralt: 'RAlt', fn: 'FN', rctrl: 'RCtrl', rshift: 'RShift', left: 'Left', up: 'Up', down: 'Down',
  right: 'Right', del: 'Delete', end: 'End', pgup: 'PgUp', pgdn: 'PgDn', back: 'Backspace', enter: 'Enter',
  '|': '\\', '<': ',', '>': '.', '?': '/',
};

const byLabel = new Map(MK75_KEYS.map((k) => [k.label.toLowerCase(), k.index]));

/** Resolve a vendor key name (case-insensitive) to a matrix/LED index, or undefined (e.g. k45, app). */
export function keyIndexByName(name: string): number | undefined {
  const n = name.trim().toLowerCase();
  if (!n) return undefined;
  const label = NAME_TO_LABEL[n] ?? n;
  return byLabel.get(label.toLowerCase());
}

export interface Unit {
  keys: number[];
  color?: [number, number, number];
}

/** Parse a unit file: one group per line, optional ":R,G,B" suffix. */
export function parseUnits(src: string): Unit[] {
  return src
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith(';'))
    .map((l) => {
      const m = l.match(/^(.*):(\d+),(\d+),(\d+)$/);
      const body = m ? m[1] : l;
      const keys = body.split(',').map(keyIndexByName).filter((i): i is number => i !== undefined);
      return { keys, color: m ? [Number(m[2]), Number(m[3]), Number(m[4])] : undefined } as Unit;
    })
    .filter((u) => u.keys.length > 0);
}

/** Parse a column file (audiobar/happy): lines = columns, ':' = segments bottom→top. */
export function parseColumns(src: string): number[][][] {
  return src
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(':').map((seg) => seg.split(',').map(keyIndexByName).filter((i): i is number => i !== undefined)));
}

export const UNIT_FILES = {
  breath: `esc,~,tab,caps,shift,ctrl,win,k45:0,0,255
1,Q,A,Z,alt
f1,2,W,S,X
f2,3,E,D,C
f3,4,R,F,V
f4,5,T,G,B,space
f5,6,Y,H,N
f6,7,U,J,M
f7,8,I,K,<,ralt
f8,9,O,L,>,fn:0,255,0
f9,0,P,;,?,rctrl
f10,-,[,',rshift,app
f11,=,],left
f12,back,|,enter,up,down
del,end,pgup,pgdn,right:255,255,0`,
  fixon: `u:255,0,0
7,y,h,j,i,8
f7,6,t,g,b,n,m,k,o,9
f6,5,r,f,v,space,<,l,p,0,f8:255,255,0
f5,4,e,d,c,>,;,[,-,f9
f4,3,w,s,x,ralt,?,',],=,f10:0,255,0
f3,2,q,a,z,alt,fn,rctrl,rshift,enter,|,back,f11,f12
f2,f1,1,tab,caps,win,left,down,up
esc,~,shift,ctrl,right,end,pgdn,pgup,del:0,0,255`,
  flower: `u
7,y,h,j,i,8
f7,6,t,g,b,n,m,k,o,9
f6,5,r,f,v,space,<,l,p,0,f8
f5,4,e,d,c,>,;,[,-,f9
f4,3,w,s,x,ralt,?,',],=,f10
f3,2,q,a,z,alt,fn,rctrl,rshift,enter,|,back,f11,f12
f2,f1,1,tab,caps,win,left,down,up
esc,~,shift,ctrl,right,end,pgdn,pgup,del`,
  rotate: `l,<,>,?,rctrl,fn,;
k,m,n,space,ralt
g,h,j,c,v,b,alt
a,s,d,f,z,x,ctrl,shift,win,k45,caps
esc,~,tab,1,2,q,w,e,r,t
f1,f2,f3,f4,3,4,5,6,7,y,u,i
f5,f6,f7,f8,8,9,o
f9,f10,0,p,-
f11,f12,=,[
back,]
|,del,end
enter,up,pgdn,pgup,right
',rshift,left,down`,
  stream: `esc,~,tab,caps,shift,ctrl,win,k45
f1,1,Q,A,Z,alt
f2,2,W,S,X
f3,3,E,D,C
F4,4,R,F,V
F5,5,T,G,B,space
f6,6,Y,H,N
f7,7,U,J,M
f8,8,I,K,<,ralt
f9,9,O,L,>,fn
f10,0,P,;,?,rctrl
f11,-,[,'
f12,=,],rshift,left
print,pause,back,|,enter,up,down
del,pgup,pgdn,end,right`,
  wheel: `right,pgdn,pgup
up,down,left,rshift,enter
rctrl,fn,?,>,;,'
k,l,m,<,ralt
h,j,n,b,space
f,g,v
s,d,x,c,alt
caps,a,shift,z,k45,ctrl,win
esc,~,tab
f1,f2,1,2,q,w
f3,f4,3,4,e,r
f5,f6,5,6,t,y
f7,f8,7,8,u,i
f9,f10,9,0,o,p
f11,f12,-,=,[,]
back,|
del,end`,
  audiobar: `ctrl:shift:caps:tab,q:~,1:esc,f1
win,alt:z:a,s:w:2,3:f2,f3
x,c:d:e,r:4:f4
v:f,g:t:5,6:f5
space:b,n:h:y,u:7:f6,f7
m:j,k:i:8,9:f8
ralt:<,>:L:o,p:0:f9
fn:?:;,':[:-,=:f10,f11
rctrl,left,down:rshift,up:enter:],|:back:f12
right:pgdn:pgup:end:del`,
  flowerRings: `U
7,8,Y,I,H,J
F7,6,T,G,B,N,M,K,O,9,F8
F6,5,R,F,V,space,<,L,P,0,F9
F5,4,E,D,C,>,;,F10
F4,3,W,S,X,RAlt,FN,?,',[,-,F11,],=
F3,2,Q,A,Z,Alt,RCtrl,RShift,enter,|,back,F12
f2,1,tab,caps,shift,win,left,up,pgup,end,del`,
} as const;
