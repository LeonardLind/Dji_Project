import { Suspense } from 'react';
import { Bounds, Center, Html, OrbitControls, useGLTF } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { MOUSE } from 'three';

const MODEL_URL = '/models/house.glb';

function HouseModel() {
  const gltf = useGLTF(MODEL_URL);

  return (
    <Bounds fit clip observe margin={1.2}>
      <Center>
        <primitive object={gltf.scene} />
      </Center>
    </Bounds>
  );
}

export default function ModelViewer() {
  return (
    <main className="viewer-page">
      <Canvas
        camera={{ position: [4, -6, 3], fov: 45, up: [0, 0, 1] }}
        shadows
        onCreated={({ camera }) => {
          camera.up.set(0, 0, 1);
        }}
      >
        <color attach="background" args={['#101820']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[8, 10, 6]} intensity={2} castShadow />
        <Suspense
          fallback={
            <Html center className="loading-card">
              Loading model...
            </Html>
          }
        >
          <HouseModel />
        </Suspense>
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          enablePan
          enableRotate
          minDistance={0.001}
          maxDistance={Infinity}
          maxPolarAngle={Math.PI}
          zoomSpeed={1.4}
          mouseButtons={{
            LEFT: MOUSE.ROTATE,
            MIDDLE: MOUSE.DOLLY,
            RIGHT: MOUSE.PAN
          }}
        />
      </Canvas>
    </main>
  );
}

useGLTF.preload(MODEL_URL);
