'use strict';

////////////////////////////////////////////////////////////////////////
// Frequently used functions and variables

const map = (n, f) => [...Array(n).keys()].map(f);

const utils = THREE['MathUtils'];
const clamp = utils['clamp'];
const lerp = utils['lerp'];
const damp = (a, b, factor, dt) => {
    const t = 1 - factor ** dt;
    return a * (1 - t) + b * t;
};
const rand = utils['randFloat'];
const min = Math.min;
const max = Math.max;
const floor = Math.floor;
const ceil = Math.ceil;
const round = Math.round;
const abs = Math.abs;
const sin = Math.sin;
const cos = Math.cos;
const atan2 = Math.atan2;
const sign = Math.sign;
const PI = Math.PI;

const v0 = new THREE['Vector3']();
const v1 = new THREE['Vector3']();

const m0 = new THREE['Matrix4']();
const m1 = new THREE['Matrix4']();

////////////////////////////////////////////////////////////////////////
// Game state

const godMode = false;
const startAutomatically = false;

const lineColor = 0x060c2c;
const lineColorText = '#060c2c';

let levelIndex = 0;
let level = null;
let levelReady = true;
let levelOver = true;

let inVr = false;

let health = 1;

let distance = 0;
let drawDistance = 0;
let totalSeconds = 0;
let timeSinceClick = 0;

let hubClosed = true;
let hubOpenness = 0;
let hubLastDistance = null;

let playHurt = false;
let playingHurt = false;

////////////////////////////////////////////////////////////////////////
// Audio

const ac = new AudioContext();
const compressor = ac['createDynamicsCompressor']();
compressor['connect'](ac['destination']);

const createSequencer = json => new TinySequencer(ac, JSON.parse(json), compressor);

const sounds = {};
for (let name in window['soundData']) {
    sounds[name] = createSequencer(window['soundData'][name]);
}

////////////////////////////////////////////////////////////////////////
// three.js setup

const clock = new THREE['Clock'](false);

const renderer = new THREE['WebGLRenderer']();
renderer['setClearColor'](0x00203e);
renderer['xr']['enabled'] = true;
renderer['xr']['setReferenceSpaceType']('local-floor');
document.body.appendChild(renderer['domElement']);

const scene = new THREE['Scene']();

////////////////////////////////////////////////////////////////////////
// Setup VR button

const button = document.querySelector('button');
let session = null;

const xr = navigator['xr'];
xr !== undefined && xr['isSessionSupported']('immersive-vr').then(supported => {
    if (supported) {
        const enterText = 'ENTER VR<br/><small>Warning: This game contains flashing lights that may make it unsuitable for people with photosensitive epilepsy</small>';

        button.innerHTML = enterText;
        button.onclick = () => {
            inVr = true;

            sounds['silent'].play();

            if (session) {
                session['end']();
                session = null;
            } else {
                xr['requestSession']('immersive-vr', {
                    'optionalFeatures': ['local-floor', 'hand-tracking'],
                }).then(s => {
                    session = s;
                    s.addEventListener('end', function end() {
                        inVr = false;

                        s.removeEventListener('end', end);
                        button.innerHTML = enterText;
                    });

                    renderer['xr']['setSession'](s);
                    button.textContent = 'EXIT VR';
                });
            }
        };
    }
});

////////////////////////////////////////////////////////////////////////
// Text creator

const createTextObject = function(width, foreground) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;

    const texture = new THREE['CanvasTexture'](canvas);
    const object = new THREE['Mesh'](
        new THREE['PlaneGeometry'](width, width / 2),
        new THREE['MeshBasicMaterial']({
            'map': texture,
            'transparent': true,
        }));
    object.renderOrder = foreground ? 2 : -2;

    const ctx = canvas.getContext('2d');

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    const drawText = (text, x, y, size, fillColor, strokeColor = null, strokeWidth = 6) => {
        ctx.font = `${size}px "Lucida Sans Unicode", "Lucida Grande", sans-serif`;
        if (strokeColor !== null) {
            ctx.lineWidth = strokeWidth;
            ctx.strokeStyle = strokeColor;
            ctx.strokeText(text, x, y);
        }
        ctx.fillStyle = fillColor;
        ctx.fillText(text, x, y);

        texture['needsUpdate'] = true;
    };

    object.clear = () => {
        ctx.clearRect(0, 0, 512, 256);

        texture['needsUpdate'] = true;
    };

    object.drawAddress = () => {
        drawText(map(4, () => round(rand(1, 255))).join('.'), 256, 128, 48, lineColorText);
    };

    object.drawTitle = level => {
        object.clear();

        ctx.fillStyle = '#f005';
        ctx.fillRect(0, 0, 512, 195);

        drawText(`FILE ${levelIndex + 1} OF ${levels.length}`, 256, 40, 24, '#fff');
        drawText(level['title'], 256, 70, 25, '#fff');
        drawText('READY TO TRANSFER', 256, 112, 36, '#fff');
        drawText('PLACE HANDS IN SOCKETS', 256, 160, 28, '#fff');

        ctx.beginPath();
        ctx.moveTo(32, 128);
        ctx.lineTo(64, 160);
        ctx.lineTo(64, 140);
        ctx.lineTo(448, 140);
        ctx.lineTo(448, 160);
        ctx.lineTo(480, 128);

        ctx.fillStyle = '#a00';
        ctx.fill();
    };

    object.drawStart = () => {
        object.clear();

        drawText('CONNECTING', 256, 127, 40, '#fff', '#000');
    };

    object.drawFinished = () => {
        object.clear();

        drawText('TRANSFER COMPLETE', 256, 127, 40, '#0f0', '#000');
    };

    let lastPercent = null;

    object.drawProgress = percent => {
        if (percent === lastPercent) {
            return;
        }
        lastPercent = percent;

        object.clear();

        drawText(percent + '%', 256, 127, 40, '#fff', '#000');
    };

    object.drawGameOver = () => {
        object.clear();

        drawText('404', 256, 127, 127, '#f00', '#000');
        drawText('FILE NOT FOUND', 256, 205, 50, '#f00', '#000');
    };

    return object;
};

////////////////////////////////////////////////////////////////////////
// Create background

const geometryBackground = new THREE['Geometry']();

const servers = [];
map(1000, i => {
    v0.set(rand(-0.5, 0.5), rand(-0.5, 0.5), rand(-0.5, 0.5))['setLength'](rand(1000, 4000));

    geometryBackground['merge'](new THREE['OctahedronGeometry'](rand(20, 40)),
        m0['identity']()['makeTranslation'](v0.x, v0.y, v0.z));

    if (i < 30) {
        const text = createTextObject(700, false);
        text.drawAddress();
        text.position.copy(v0);
        text['up'].set(rand(-0.5, 0.5), rand(-0.5, 0.5), rand(-0.5, 0.5))['normalize']();
        text['lookAt'](0, 0, 0);
        text['matrixAutoUpdate'] = false;
        text['updateMatrix']();
        scene.add(text);
    }

    servers.filter(p => v0['distanceTo'](p) < 500).forEach(p => {
        m0['identity']()['makeTranslation']((v0.x + p.x) / 2, (v0.y + p.y) / 2, (v0.z + p.z) / 2)['multiply'](
            m1['identity']()['lookAt'](v0, p, v1.set(0, 1, 0)));

        const geometry = new THREE['CylinderGeometry'](2, 2, v0['distanceTo'](p), 3)['rotateX'](PI / 2);
        geometryBackground['merge'](geometry, m0);
    });

    servers.push(v0.clone());
});

const background = new THREE['Mesh'](
    geometryBackground,
    new THREE['MeshBasicMaterial']({
        'color': lineColor,
    }));

scene.add(background);

////////////////////////////////////////////////////////////////////////
// Create tunnel

const tunnelData = new Uint8Array(4096 * 4);
const tunnelTexture = new THREE['DataTexture'](tunnelData, 4096, 1,
    undefined, undefined, undefined, undefined, undefined, THREE['LinearFilter']);

const tunnelState = map(4, () => new THREE['Vector3']());

const materialTunnel = new THREE['ShaderMaterial']({
    'uniforms': {
        'tex': { 'value': tunnelTexture },
        'd': { 'type': 'v3v', 'value': tunnelState },
        // tex:
        //     y 0 x: distance in meters
        //       x: lane A center angle (0 down .25 right .5 up .75 left)
        //       y: lane B center angle (0 down .25 right .5 up .75 left)
        //       z: lane A central angle (0-1)
        //       w: lane B central angle (0-1)
        //
        // d[0].x: tunnel length
        // d[0].y: tunnel hurt
        // d[0].z: tunnel draw distance
        //
        // d[1].x: current distance
        // d[1].y: current time
        // d[1].z: draw hands
        //
        // d[2].x: hand A angle (0 down .25 right .5 up .75 left)
        // d[2].y: hand A offset
        // d[2].z: hand A hurt
        //
        // d[3].x: hand B angle (0 down .25 right .5 up .75 left)
        // d[3].y: hand B offset
        // d[3].z: hand B hurt
    },
    'vertexShader': `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
}`,
    'fragmentShader': `
#include <common>

uniform sampler2D tex;
uniform vec3 d[4];

varying vec2 vUv;

void main() {
    float x = vUv.x * d[0].x;
    float dx = x - d[1].x;
    float t = d[1].y;

    for (int i = 0; i < 2; i++) {
        float waveWidth = pow(max(1. - abs(d[2 + i].y - dx + sin((dx + t) * 40.) * (d[2 + i].z + .1) * .1), .0) * .2, 2.);
        float waveDist = abs(mod((d[2 + i].x - 1. / 4.) - vUv.y + .5, 1.) - .5);
        float waveOverlap = max((waveWidth - waveDist) / waveWidth, 0.);

        gl_FragColor.xyz += (i > 0 ? vec3(10., 2., 2.) : vec3(2., 2., 10.)) * waveOverlap * d[1].z;
    }

    vec4 laneData = (
        texture2D(tex, vec2((x - .5) / 4096., .5)) +
        texture2D(tex, vec2(x / 4096., .5)) +
        texture2D(tex, vec2((x + .5) / 4096., .5))) / 3.;
    float laneBorderWidth = .02 +
        sin(mod(t, 1.) * PI * 4. + mod(x * .5, 2.) * PI) * .005 +
        sin(mod(t, 1.) * PI * 4. + mod(x * .5, 1.) * PI * 4.) * .005 +
        max(.05 - abs(dx), 0.);
    vec2 laneDist = abs(mod((laneData.xy - 1. / 4.) - vUv.y + .5, 1.) - .5);
    vec2 laneOverlap = (laneData.zw - laneDist) / laneBorderWidth * 5.;
    float isBorder = max(0., max(1. - abs(laneOverlap.x), 1. - abs(laneOverlap.y)));
    float isTunnel = step(1., -max(laneOverlap.x, laneOverlap.y));
    float tunnelWall = .2 + pow(sin((vUv.y + sin(dx + x * .5) * .1 + dx * .02 + x * .002) * PI * 6.), 3.) * .1;

    gl_FragColor += vec4(
        isBorder * 10. + max(laneOverlap.y * .5, 0.),
        max(isTunnel * tunnelWall, isBorder * 10.),
        max(isTunnel * tunnelWall, isBorder * 10. + max(laneOverlap.x * .5, 0.)),
        1.);

    gl_FragColor *= max(min(d[0].z - x, 1.), 0.) * max(min(dx + 8., 1.), 0.);
    gl_FragColor += max(sin(vUv.y * PI * 16. + x * 2.) + 2. - abs(d[0].z - x) * .5, 0.) * min(d[0].z * .01, 1.);
    gl_FragColor *= mix(vec4(1., 1., 1., 1.), vec4(1., 0., 0., 1.), d[0].y) * min(d[0].z, 1.);
    gl_FragColor = min(gl_FragColor, 1.) * .8;
}`,
    'blending': THREE['AdditiveBlending'],
    'depthTest': false,
    'side': THREE['DoubleSide'],
    'transparent': true,
});

const createTunnel = curve => {
    const length = curve['getLength']();
    const segments = floor(length);
    const lengths = curve['getLengths'](segments);
    const points = curve['getSpacedPoints'](segments);

    const lerpParam = (param, u, target) => {
        const t = u / length * segments;
        const i = clamp(floor(t), 0, segments - 2);
        const p = tunnel[param];
        return target.copy(p[i])['lerp'](p[i + 1], t - i);
    };

    const v0 = new THREE['Vector3']();
    const v1 = new THREE['Vector3']();

    const q0 = new THREE['Quaternion']();

    const raycaster = new THREE['Raycaster']();
    const intersections = [];

    const radialSegments = 16;

    const tunnel = {
        lerpParam,
        length,
        'lengths': lengths,
        'points': points,
        ...curve['computeFrenetFrames'](segments, false),
        pointAt: (u, radius, angle, target) => {
            lerpParam('normals', u, v0)['multiplyScalar'](sin(angle) * radius);
            lerpParam('binormals', u, v1)['multiplyScalar'](cos(angle) * radius);
            return lerpParam('points', u, target).sub(v0).sub(v1);
        },
        moveTo: (u, object, dir, t = 1) => {
            lerpParam('points', u, object.position);
            lerpParam('binormals', u, object['up']);
            const rotation = q0['setFromRotationMatrix'](m0['lookAt'](
                object.position,
                lerpParam('tangents', u, v0)['multiplyScalar'](dir).add(object.position),
                lerpParam('binormals', u, v1)));
            object['quaternion']['slerp'](rotation, t);
        },
        raycast: (uMin, uMax, origin, direction) => {
            const start = geometryTunnel['drawRange']['start'];
            const count = geometryTunnel['drawRange']['count'];

            const indexCount = geometryTunnel['index']['count'];
            const iMin = clamp(floor(uMin / tunnel.length * segments) * radialSegments * 6, 0, indexCount - 1);
            const iMax = clamp(ceil(uMax / tunnel.length * segments) * radialSegments * 6, 0, indexCount - 1);

            geometryTunnel['setDrawRange'](iMin, iMax - iMin);

            raycaster['ray'].set(origin, direction);
            intersections.length = 0;
            raycaster['intersectObject'](tunnel.object, false, intersections);

            geometryTunnel['setDrawRange'](start, count);

            return intersections;
        },
    };

    const geometryTunnel = new THREE['TubeBufferGeometry'](curve, segments, 2, radialSegments, false);

    tunnel.object = new THREE['Mesh'](geometryTunnel, materialTunnel);
    tunnel.object.renderOrder = 1;
    scene.add(tunnel.object);

    const geometryCables = new THREE['Geometry']();

    map(50, i => {
        const cableAngle = rand(0, PI * 2);
        const cableRotation = rand(-0.005, 0.005);
        const cableRadius = rand(4, 24);
        const cableWaypoints = map(segments, i => tunnel.pointAt(
            lengths[i], cableRadius, cableAngle + cableRotation * lengths[i], new THREE['Vector3']()));

        geometryCables['merge'](new THREE['TubeGeometry'](
            new THREE['CatmullRomCurve3'](cableWaypoints),
            cableWaypoints.length, 0.05, 3, false));
    });

    tunnel.object.add(new THREE['Mesh'](
        geometryCables,
        new THREE['MeshBasicMaterial']({
            'color': lineColor,
        })));

    tunnel.object['visible'] = false;

    return tunnel;
};

////////////////////////////////////////////////////////////////////////
// Create camera rig

const cameraRig = new THREE['Group']();
scene.add(cameraRig);

const cameraOffset = new THREE['Group']();
cameraRig.add(cameraOffset);

const camera = new THREE['PerspectiveCamera'](80, 1, 0.1, 10000);
camera.position.setY(1.6);
cameraOffset.add(camera);

const resize = () => {
    renderer['setSize'](innerWidth, innerHeight);

    camera['aspect'] = innerWidth / innerHeight;
    camera['updateProjectionMatrix']();
};
addEventListener('resize', resize);
resize();

const gui = createTextObject(2, true);
gui.position.set(0, 1, -2);
cameraRig.add(gui);

////////////////////////////////////////////////////////////////////////
// Create hub

const hub = new THREE['Group']();
scene.add(hub);

const hubWalls = [];

map(2, upper => {
    const geometry = new THREE['ConeGeometry'](4, 5, 4, 1, true);
    geometry.translate(0, 2.495, 0);

    map(32, () => {
        const y = rand(0, 3);
        const radius = 2.6 - abs(y) + rand(0.1, 0.3);
        const angle = rand(0, PI * 2);
        geometry['merge'](
            new THREE['CylinderGeometry'](radius, radius, rand(0.02, 0.1), 20, 1, true, angle, 1),
            m0['makeTranslation'](0, y, 0));
    });

    geometry.rotateX(upper * PI);

    const materialHub = new THREE['MeshBasicMaterial']({
        'color': 0x023168,
        'side': THREE['DoubleSide'],
    });

    const object = new THREE['Mesh'](geometry, materialHub);
    const lines = new THREE['LineSegments'](
        new THREE['EdgesGeometry'](geometry, 16),
        new THREE['LineBasicMaterial']({ 'color': 0 }));
    lines.scale.set(0.995, 0.995, 0.995);

    object.add(lines);
    hub.add(object);

    hubWalls.push(object);
});

map(2, alt => {
    const geometry = new THREE['ConeGeometry'](0.6 + alt * 0.03, 0.5, 6, 1, false);
    geometry.translate(0, 0.25 + alt * 0.01, 0);
    geometry.rotateX(PI);

    const materialHub = new THREE['MeshBasicMaterial']({
        'color': alt ? 0xff0000 : 0x330000,
        'transparent': true,
    });

    const object = new THREE['Mesh'](geometry, materialHub);
    object.renderOrder = 3;
    cameraRig.add(object);
});

const sockets = map(2, side => map(2, sphere => {
    const geometry = sphere ?
        new THREE['OctahedronGeometry'](0.15, 2) :
        new THREE['RingGeometry'](0.2, 0.3, 6);

    const material = new THREE['MeshBasicMaterial']({
        'color': side ? 0xff4444 : 0x4444ff,
        'transparent': true,
        'side': THREE[sphere ? 'FrontSide' : 'DoubleSide'],
        'opacity': 0.8,
    });

    const object = new THREE['Mesh'](geometry, material);
    object.renderOrder = 1.5;
    object.position.set(side * 1.2 - .6, 0, 0.4);
    hub.add(object);

    let lastSelected = null;
    object.setSelected = selected => {
        if (selected !== lastSelected) {
            lastSelected = selected;

            if (timeSinceClick > 0.2 && selected) {
                timeSinceClick = 0;
                sounds['click'].play();
            }

            material['color']['setHex'](
                selected ? side ? 0xffaaaa : 0xaaaaff : side ? 0x880000 : 0x000088);
            material['needsUpdate'] = true;
        }
    };

    return object;
}));

////////////////////////////////////////////////////////////////////////
// Create hands

const hands = map(2, side => {
    const grip = renderer['xr']['getControllerGrip'](side);
    cameraOffset.add(grip);

    const sphere = new THREE['Group']();
    grip.add(sphere);

    const cone = new THREE['Group']();
    cone['rotateX'](PI);
    grip.add(cone);

    const material = new THREE['MeshBasicMaterial']({
        'transparent': true,
        'side': THREE['BackSide'],
        'blending': THREE['AdditiveBlending'],
        'depthTest': false,
    })

    map(4, i => {
        const geometrySphere = new THREE['OctahedronGeometry'](0.15 - i * 0.01, 2);
        const objectSphere = new THREE['Mesh'](geometrySphere, material);
        objectSphere.renderOrder = 3;
        sphere.add(objectSphere);

        const points = map(11, j => new THREE['Vector2']((0.05 + (j ** 1.8) * 0.003) * (1 - i * 0.15), -j * 0.1));
        const geometryCone = new THREE['LatheGeometry'](points, 16)['rotateX'](-PI / 2);
        const objectCone = new THREE['Mesh'](geometryCone, material);
        objectCone.renderOrder = 3;
        cone.add(objectCone);
    });

    let hurt = 0;
    let lastInside = null;

    const hand = {
        update: dt => {
            grip['getWorldPosition'](v0);

            if (levelOver) {
                const socket = sockets[side][1];
                hand.inMount = socket['getWorldPosition'](v1)['distanceTo'](v0) < 0.23;
                socket.setSelected(hand.inMount);
            }

            let inside = levelOver || distance < 20 || distance > level.tunnel.length - 20;

            const intersections = level.tunnel.raycast(distance - 4, distance + 10,
                v0, v1.set(0, 0, -1)['transformDirection'](grip['matrixWorld']));
            if (intersections.length > 0 && !levelOver) {
                cone.scale.setZ(intersections[0]['distance']);

                const uv = intersections[0]['uv'];
                const handDistance = uv.x * level.tunnel.length;
                const handAngle = uv.y + 1 / 4;
                const i = clamp(floor(handDistance), 0, 4094);

                const centerAngle = lerp(
                    tunnelData[i * 4 + side],
                    tunnelData[(i + 1) * 4 + side], handDistance - i) / 255;
                const centralAngle = lerp(
                    tunnelData[i * 4 + side + 2],
                    tunnelData[(i + 1) * 4 + side + 2], handDistance - i) / 255;

                inside = inside || Math.abs((handAngle - centerAngle + 0.5) % 1.0 - 0.5) < centralAngle;

                hurt = damp(hurt, 1 - inside, 0.0001, dt);

                tunnelState[2 + side].set(handAngle, uv.x * level.tunnel.length - distance, hurt);
            } else {
                tunnelState[2 + side].set(0, -100, 0);
            }

            if (lastInside !== inside) {
                lastInside = inside;

                material['color']['setHex'](inside || levelOver ? side ? 0xdd4444 : 0x4444dd : side ? 0xcc1111 : 0x1111cc);
                material['needsUpdate'] = true;
            }

            const sphereScale = 1 + sin(totalSeconds * 5) * 0.02;
            sphere.scale.set(sphereScale, sphereScale, sphereScale);

            cone.position.set(levelOver * 1000, 0, 0);

            if (levelOver) {
                return;
            }

            if (!inside) {
                playHurt = true;
            }

            const coneScale = inside ? 1 : rand(0.3, 0.7);
            cone.scale.setX(coneScale);
            cone.scale.setY(coneScale);

            health = min(1, health + (inside || godMode ? 0.5 * dt : -dt));
        },
    };
    return hand;
});

////////////////////////////////////////////////////////////////////////
// Create levels

const levels = window['levelData'].map(level => {
    const sequencer = createSequencer(level['song']);

    const curveDef = level['curve'];
    const waypoints = map(curveDef[0], i => new THREE['Vector3'](rand(-curveDef[1], curveDef[1]), rand(-curveDef[1], curveDef[1]), i * curveDef[2]));

    const tunnel = createTunnel(new THREE['CatmullRomCurve3'](waypoints));

    const parameters = map(4096 * 4, i => (i % 4 > 1) * max(2 - i / 32, level['defaultWidth'] / 64));

    const addInfluence = (time, duration, strength, param, decay) => {
        const d0 = time / sequencer.duration * tunnel.length;
        const d1 = (time + duration) / sequencer.duration * tunnel.length;
        for (let i = max(ceil(d0), 0); i < min(ceil(d1), 4096); i++) {
            parameters[i * 4 + param] = clamp(parameters[i * 4 + param] + (decay ? lerp(strength, 0, (i - d0) / (d1 - d0)) : strength), -1, 1);
        }
    };

    sequencer.tracks.forEach((track, t) => {
        // Influence structure:
        // 0: Rotation
        // 1: Size
        // 2: Hand A phase offset
        // 3: Hand B phase offset

        const influence = level['influences'][t];
        if (influence === null) {
            return;
        }

        map(2, side => {
            track.notes.forEach(note => {
                const handInfluence = sin(influence[2 + side] + sin(note.time / 5 * PI * 2)) / 2 + 0.5;
                const rotation = influence[0] * handInfluence * (1 - 2 * (rand(0, 1) < 0.5));
                const size = influence[1] * handInfluence;

                addInfluence(note.time, note.duration, rotation, side, false);
                addInfluence(note.time + note.duration, 2, rotation, side, true);
                addInfluence(note.time, note.duration, size, 2 + side, false);
                addInfluence(note.time + note.duration, 2, size, 2 + side, true);
            });
        });
    });

    return {
        title: level['title'],
        sequencer,
        tunnel,
        data: parameters.map((v, i) => clamp(round(
            (i % 4 === 0) * (64 + clamp(v, -.7, 0.7) * 64) +
            (i % 4 === 1) * (192 - clamp(v, -.7, 0.7) * 64) +
            (i % 4 > 1) * clamp(v * 64, level['minWidth'], 64)), 0, 255)),
        velocity: tunnel.length / sequencer.duration,
    };
});

const startLevel = () => {
    if (level !== null) {
        level.tunnel.object['visible'] = false;

        level.sequencer.stop();
    }

    level = levels[levelIndex];
    level.tunnel.object['visible'] = true;

    tunnelData.set(level.data);
    tunnelTexture['needsUpdate'] = true;

    health = 1;

    distance = 0;
    drawDistance = 0;

    levelReady = true;

    gui.drawTitle(level);
};

////////////////////////////////////////////////////////////////////////
// Main loop

const update = (_, frame = null) => {
    const dt = clock['getDelta']();

    totalSeconds += dt;
    timeSinceClick += dt;

    // Update tunnel distance
    if (level.sequencer.isPlaying()) {
        distance = level.sequencer.currentTime() * level.velocity;
    }

    // Update camera rig position
    const playerDistance = max(distance - min(3, level.tunnel.length - distance), 0);
    level.tunnel.moveTo(playerDistance, cameraRig, 1, levelReady ? 1 : damp(0, 1, 1e-2, dt));
    cameraRig.position.sub(cameraRig['up']);
    cameraRig['updateWorldMatrix'](false, true);

    // Update hurt sound effect
    playHurt = false;

    // Update hands
    hands.forEach(hand => hand.update(dt));

    // Start hurt sound effect
    if (playHurt !== playingHurt) {
        playingHurt = playHurt;
        if (playHurt) {
            sounds['hurt'].play(true);
        } else {
            sounds['hurt'].stop();
        }
    }

    // Update hand sockets
    sockets.forEach((sockets, side) => sockets.forEach(object => {
        object.scale.set(1 - hubOpenness, 1 - hubOpenness, 1 - hubOpenness);
        object.rotation.set(0, PI / 2, totalSeconds * (0.5 - side));
    }));

    if (levelOver) {
        // Start game
        if (levelReady && hubOpenness < 0.1 && (
            startAutomatically || inVr && hands.every(hand => hand.inMount))) {
            levelReady = false;
            hubClosed = false;

            sounds['hub'].play();

            gui.drawStart();

            setTimeout(() => {
                level.sequencer.play(false, 0.2);

                gui.clear();

                levelOver = false;
            }, 1000);
        }

        // Update draw distance
        drawDistance = max(0, drawDistance - dt * 50);
    } else {
        // Update progres indicator
        gui.drawProgress(round(distance / level.tunnel.length * 100));

        // Finished or game over
        if (!level.sequencer.isPlaying()) {
            levelIndex = (levelIndex + 1) % levels.length;
            setTimeout(startLevel, 3500);

            levelOver = true;
            hubClosed = true;
            sounds['hub'].play();

            gui.drawFinished();
        } else if (health <= 0) {
            setTimeout(startLevel, 4000);
            setTimeout(() => {
                hubClosed = true;

                sounds['hub'].play();
            }, 2000);

            sounds['lose'].play();

            levelOver = true;

            gui.drawGameOver();
        }

        // Update draw distance
        drawDistance = min(distance + 50, distance ** 1.1);
    }

    // Update hub position
    const hubDistance = levelOver ? playerDistance / level.tunnel.length : min(floor(distance / level.tunnel.length * 2), 1);
    if (hubLastDistance !== hubDistance) {
        hubLastDistance = hubDistance;

        const u = hubDistance * level.tunnel.length;
        level.tunnel.moveTo(u, hub, -1);
    }

    // Update hub walls
    hubOpenness = damp(hubOpenness, 1 - hubClosed, 0.3, dt);
    hubWalls.forEach((wall, i) => {
        const dir = 1 - (i % 2) * 2;
        wall.rotation.set(0, totalSeconds * 0.15 + max(0, hubOpenness * 2) ** 3 * dir, 0);
        wall.position.set(0,  max(0, hubOpenness * 2) ** 2 * dir, 0);
    });

    // Update background
    background.position.copy(cameraRig.position)['multiplyScalar'](.7);

    // Copy information to shader
    tunnelState[0].set(level.tunnel.length, 1 - health, drawDistance);
    tunnelState[1].set(distance, totalSeconds, 1 - levelOver);

    // Limit VR movement
    if (frame !== null && renderer['xr']['isPresenting']) {
        const pose = frame['getViewerPose'](renderer['xr']['getReferenceSpace']());
        if (pose !== null && pose['views'].length > 0) {
            const offset = v0.copy(cameraOffset.position)['negate']().sub(pose['views'][0]['transform'].position);
            cameraOffset.position.add(offset.set(
                max(abs(offset.x) - 0.5, 0) * sign(offset.x),
                0,
                max(abs(offset.z) - 0.5, 0) * sign(offset.z)));
        }
    }

    // Render scene
    renderer['render'](scene, camera);
};

// Start game
addEventListener('load', () => {
    clock['start']();

    renderer['setAnimationLoop'](update);

    startLevel();

    renderer['compile'](scene, camera);
});
