import { ChangeEvent, useEffect, useRef, useState } from "react";
import { MOUSE, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  PointCloudOctree,
  PointColorType,
  PointShape,
  PointSizeType,
  Potree,
} from "potree-core";

const POINT_CLOUD_METADATA = "metadata.json";
const POINT_CLOUD_BASE_URL = "/pointcloud/house/";
const DEFAULT_POINT_SIZE = 0.18;
const DEFAULT_POINT_BUDGET = 450_000;

function fitCameraToPointCloud(
  camera: PerspectiveCamera,
  controls: OrbitControls,
  cloud: PointCloudOctree,
) {
  const box = cloud.getBoundingBoxWorld();
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 1);
  const fitDistance =
    maxDimension / (2 * Math.tan((camera.fov * Math.PI) / 360));
  const direction = new Vector3(4, -6, 3).normalize();
  const framingTarget = center.clone();
  framingTarget.z -= size.z * 0.45;

  camera.position.copy(framingTarget).addScaledVector(direction, fitDistance * 0.85);
  camera.near = Math.max(fitDistance / 1000, 0.01);
  camera.far = Math.max(fitDistance * 100, 1000);
  camera.updateProjectionMatrix();

  controls.target.copy(framingTarget);
  controls.update();
}

function centerPointCloud(cloud: PointCloudOctree) {
  cloud.updateMatrixWorld(true);
  const center = cloud.getBoundingBoxWorld().getCenter(new Vector3());
  cloud.position.sub(center);
  cloud.updateMatrixWorld(true);
}

export default function PointCloudViewer() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const cloudRef = useRef<PointCloudOctree | null>(null);
  const potreeRef = useRef<Potree | null>(null);
  const [pointSize, setPointSize] = useState(DEFAULT_POINT_SIZE);
  const [pointBudget, setPointBudget] = useState(DEFAULT_POINT_BUDGET);
  const [status, setStatus] = useState("Loading point cloud...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return undefined;
    }

    let animationFrame = 0;
    let disposed = false;
    const scene = new Scene();
    const camera = new PerspectiveCamera(
      45,
      mount.clientWidth / mount.clientHeight,
      0.1,
      100000,
    );
    const renderer = new WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true,
    });
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    const potree = new Potree();
    potreeRef.current = potree;
    const pointClouds: PointCloudOctree[] = [];

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor(0x101820, 1);
    mount.appendChild(renderer.domElement);

    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.enableRotate = true;
    controls.minDistance = 0.001;
    controls.maxDistance = Infinity;
    controls.maxPolarAngle = Math.PI;
    controls.zoomSpeed = 1.4;
    controls.mouseButtons = {
      LEFT: MOUSE.ROTATE,
      MIDDLE: MOUSE.DOLLY,
      RIGHT: MOUSE.PAN,
    };
    potree.pointBudget = DEFAULT_POINT_BUDGET;

    const resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    resizeObserver.observe(mount);

    potree
      .loadPointCloud(POINT_CLOUD_METADATA, POINT_CLOUD_BASE_URL)
      .then((cloud) => {
        if (disposed) {
          cloud.dispose();
          return;
        }

        cloud.material.pointColorType = PointColorType.RGB;
        cloud.material.pointSizeType = PointSizeType.ADAPTIVE;
        cloud.material.shape = PointShape.SQUARE;
        cloud.material.size = DEFAULT_POINT_SIZE;
        cloud.material.minSize = 0.03;
        cloud.material.maxSize = 1.2;
        cloud.showBoundingBox = false;
        centerPointCloud(cloud);
        scene.add(cloud);
        pointClouds.push(cloud);
        cloudRef.current = cloud;
        fitCameraToPointCloud(camera, controls, cloud);
        setStatus("");
      })
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to load point cloud.",
        );
      });

    const render = () => {
      controls.update();
      potree.updatePointClouds(pointClouds, camera, renderer);
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(render);
    };
    render();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.dispose();
      pointClouds.forEach((cloud) => cloud.dispose());
      cloudRef.current = null;
      potreeRef.current = null;
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  const handlePointSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextSize = Number(event.target.value);
    setPointSize(nextSize);

    if (cloudRef.current) {
      cloudRef.current.material.size = nextSize;
      cloudRef.current.material.needsUpdate = true;
    }
  };

  const handlePointBudgetChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextBudget = Number(event.target.value);
    setPointBudget(nextBudget);

    if (potreeRef.current) {
      potreeRef.current.pointBudget = nextBudget;
    }
  };

  return (
    <main className="viewer-page">
      <div ref={mountRef} className="canvas-host" />
      <aside
        className="pointcloud-panel"
        aria-label="Point cloud display controls"
      >
        <label>
          <span>Point size</span>
          <strong>{pointSize.toFixed(2)}</strong>
          <input
            max="1.2"
            min="0.03"
            onChange={handlePointSizeChange}
            step="0.03"
            type="range"
            value={pointSize}
          />
        </label>
        <label>
          <span>Point budget</span>
          <strong>{Math.round(pointBudget / 1000)}k</strong>
          <input
            max="1500000"
            min="50000"
            onChange={handlePointBudgetChange}
            step="50000"
            type="range"
            value={pointBudget}
          />
        </label>
      </aside>
      {(status || error) && (
        <div className="loading-card overlay">{error ?? status}</div>
      )}
    </main>
  );
}
