import { ChangeEvent, WheelEvent, useCallback, useEffect, useRef, useState } from 'react';
import { fromArrayBuffer } from 'geotiff';

const ORTHOPHOTO_LAYERS = [
  {
    id: 'orthophoto',
    label: 'Orthophoto',
    url: '/orthophoto/Grankllevgen-2026-06-23-orthophoto.tif',
    opacity: 1
  },
  {
    id: 'vari',
    label: 'VARI',
    url: '/orthophoto/Grankllevgen-2026-06-23-orthophoto-VARI.tif',
    opacity: 0
  },
  {
    id: 'dsm',
    label: 'DSM',
    url: '/orthophoto/Grankllevgen-2026-06-23-dsm.tif',
    opacity: 0
  }
] as const;

const CONTOUR_LAYER = {
  id: 'contours',
  label: 'Contours',
  url: '/orthophoto/Grankllevgen-2026-06-23-contours.json',
  opacity: 1
} as const;

const MAP_LAYERS = [...ORTHOPHOTO_LAYERS, CONTOUR_LAYER] as const;

type ImageSource = HTMLCanvasElement;
type LayerId = (typeof MAP_LAYERS)[number]['id'];
type LayerState = Record<LayerId, { opacity: number; visible: boolean }>;
type Bounds = [number, number, number, number];
type RasterLayerId = (typeof ORTHOPHOTO_LAYERS)[number]['id'];
type LoadedRasterLayer = {
  id: RasterLayerId;
  label: string;
  image: ImageSource;
  bounds: Bounds | null;
};
type ContourPath = Array<[number, number]>;
type LoadedContourLayer = {
  id: typeof CONTOUR_LAYER.id;
  label: string;
  paths: ContourPath[];
  bounds: Bounds | null;
};
type ImageTransform = {
  zoom: number;
  offsetX: number;
  offsetY: number;
};

const initialLayerState = MAP_LAYERS.reduce((state, layer) => {
  state[layer.id] = { opacity: layer.opacity, visible: true };
  return state;
}, {} as LayerState);

function getCanvasFit(canvas: HTMLCanvasElement, source: ImageSource) {
  const scale = Math.min(canvas.width / source.width, canvas.height / source.height);
  return {
    scale,
    x: (canvas.width - source.width * scale) / 2,
    y: (canvas.height - source.height * scale) / 2
  };
}

function normalizeSample(value: number, max: number) {
  if (max <= 0) {
    return 0;
  }

  return max > 255 ? (value / max) * 255 : value;
}

type GeoJsonPosition = [number, number, number?];
type GeoJsonFeature = {
  geometry?: {
    type: 'LineString' | 'MultiLineString' | string;
    coordinates: GeoJsonPosition[] | GeoJsonPosition[][];
  } | null;
};
type GeoJsonFeatureCollection = {
  features?: GeoJsonFeature[];
};

function expandBounds(bounds: Bounds | null, x: number, y: number): Bounds {
  if (!bounds) {
    return [x, y, x, y];
  }

  return [
    Math.min(bounds[0], x),
    Math.min(bounds[1], y),
    Math.max(bounds[2], x),
    Math.max(bounds[3], y)
  ];
}

async function loadTiffLayer(
  layer: (typeof ORTHOPHOTO_LAYERS)[number]
): Promise<LoadedRasterLayer> {
  const response = await fetch(layer.url);
  if (!response.ok) {
    throw new Error(`Unable to fetch ${layer.url}`);
  }

  const tiff = await fromArrayBuffer(await response.arrayBuffer());
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const bounds = image.getBoundingBox() as Bounds;
  const raster = await image.readRasters({ interleave: true });
  const samples = image.getSamplesPerPixel();
  const source = raster as Uint8Array | Uint16Array | Float32Array;
  const output = new Uint8ClampedArray(width * height * 4);

  let max = 0;
  for (let index = 0; index < source.length; index += 1) {
    max = Math.max(max, Number(source[index]));
  }

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const sourceIndex = pixel * samples;
    const outputIndex = pixel * 4;
    const red = normalizeSample(Number(source[sourceIndex] ?? 0), max);
    const green = normalizeSample(Number(source[sourceIndex + Math.min(1, samples - 1)] ?? red), max);
    const blue = normalizeSample(Number(source[sourceIndex + Math.min(2, samples - 1)] ?? red), max);

    output[outputIndex] = red;
    output[outputIndex + 1] = green;
    output[outputIndex + 2] = blue;
    output[outputIndex + 3] = 255;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to create canvas context for orthophoto.');
  }

  context.putImageData(new ImageData(output, width, height), 0, 0);
  return {
    id: layer.id,
    label: layer.label,
    image: canvas,
    bounds
  };
}

async function loadContourLayer(): Promise<LoadedContourLayer> {
  const response = await fetch(CONTOUR_LAYER.url);
  if (!response.ok) {
    throw new Error(`Unable to fetch ${CONTOUR_LAYER.url}`);
  }

  const geoJson = (await response.json()) as GeoJsonFeatureCollection;
  const paths: ContourPath[] = [];
  let bounds: Bounds | null = null;

  for (const feature of geoJson.features ?? []) {
    const geometry = feature.geometry;
    if (!geometry) {
      continue;
    }

    const lineStrings =
      geometry.type === 'LineString'
        ? [geometry.coordinates as GeoJsonPosition[]]
        : geometry.type === 'MultiLineString'
          ? (geometry.coordinates as GeoJsonPosition[][])
          : [];

    for (const lineString of lineStrings) {
      const path: ContourPath = [];
      for (const position of lineString) {
        const [x, y] = position;
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          continue;
        }

        path.push([x, y]);
        bounds = expandBounds(bounds, x, y);
      }

      if (path.length > 1) {
        paths.push(path);
      }
    }
  }

  return {
    id: CONTOUR_LAYER.id,
    label: CONTOUR_LAYER.label,
    paths,
    bounds
  };
}

export default function OrthophotoViewer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rasterLayersRef = useRef<LoadedRasterLayer[]>([]);
  const contourLayerRef = useRef<LoadedContourLayer | null>(null);
  const layerStateRef = useRef<LayerState>(initialLayerState);
  const transformRef = useRef<ImageTransform>({ zoom: 1, offsetX: 0, offsetY: 0 });
  const [layerState, setLayerState] = useState<LayerState>(initialLayerState);
  const [status, setStatus] = useState('Loading orthophoto layers...');
  const [error, setError] = useState<string | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    const baseLayer = rasterLayersRef.current[0];
    if (!canvas || !context || !baseLayer) {
      return;
    }

    const fit = getCanvasFit(canvas, baseLayer.image);
    const transform = transformRef.current;
    const scale = fit.scale * transform.zoom;
    const width = baseLayer.image.width * scale;
    const height = baseLayer.image.height * scale;
    const x = (canvas.width - width) / 2 + transform.offsetX;
    const y = (canvas.height - height) / 2 + transform.offsetY;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#101820';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    for (const layer of rasterLayersRef.current) {
      const settings = layerStateRef.current[layer.id];
      if (!settings.visible || settings.opacity <= 0) {
        continue;
      }

      context.globalAlpha = settings.opacity;
      context.drawImage(layer.image, x, y, width, height);
    }

    const contourLayer = contourLayerRef.current;
    const contourSettings = layerStateRef.current.contours;
    const mapBounds = baseLayer.bounds ?? contourLayer?.bounds;
    if (contourLayer && mapBounds && contourSettings.visible && contourSettings.opacity > 0) {
      const [minX, minY, maxX, maxY] = mapBounds;
      const mapWidth = maxX - minX;
      const mapHeight = maxY - minY;

      if (mapWidth > 0 && mapHeight > 0) {
        context.globalAlpha = contourSettings.opacity;
        context.strokeStyle = '#fff06a';
        context.lineWidth = Math.max(window.devicePixelRatio * 1.4, 1);
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.shadowColor = 'rgba(0, 0, 0, 0.55)';
        context.shadowBlur = window.devicePixelRatio * 1.5;

        for (const path of contourLayer.paths) {
          context.beginPath();
          path.forEach(([mapX, mapY], index) => {
            const pixelX = ((mapX - minX) / mapWidth) * baseLayer.image.width;
            const pixelY = ((maxY - mapY) / mapHeight) * baseLayer.image.height;
            const canvasX = x + pixelX * scale;
            const canvasY = y + pixelY * scale;

            if (index === 0) {
              context.moveTo(canvasX, canvasY);
            } else {
              context.lineTo(canvasX, canvasY);
            }
          });
          context.stroke();
        }

        context.shadowBlur = 0;
      }
    }

    context.globalAlpha = 1;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    let cancelled = false;
    const resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      canvas.width = Math.max(Math.floor(width * window.devicePixelRatio), 1);
      canvas.height = Math.max(Math.floor(height * window.devicePixelRatio), 1);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      draw();
    });

    resizeObserver.observe(canvas);
    Promise.all([Promise.all(ORTHOPHOTO_LAYERS.map(loadTiffLayer)), loadContourLayer()])
      .then(([rasterLayers, contourLayer]) => {
        if (cancelled) {
          return;
        }

        rasterLayersRef.current = rasterLayers;
        contourLayerRef.current = contourLayer;
        setStatus('');
        draw();
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Unable to load orthophoto layers.');
      });

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
    };
  }, [draw]);

  const updateLayer = (id: LayerId, nextValue: Partial<LayerState[LayerId]>) => {
    const nextState = {
      ...layerStateRef.current,
      [id]: {
        ...layerStateRef.current[id],
        ...nextValue
      }
    };

    layerStateRef.current = nextState;
    setLayerState(nextState);
    draw();
  };

  const handleOpacityChange = (id: LayerId) => (event: ChangeEvent<HTMLInputElement>) => {
    updateLayer(id, { opacity: Number(event.target.value) / 100 });
  };

  const handleWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    const baseLayer = rasterLayersRef.current[0];
    if (!canvas || !baseLayer) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const cursorX = (event.clientX - rect.left) * window.devicePixelRatio;
    const cursorY = (event.clientY - rect.top) * window.devicePixelRatio;
    const fit = getCanvasFit(canvas, baseLayer.image);
    const current = transformRef.current;
    const currentScale = fit.scale * current.zoom;
    const currentWidth = baseLayer.image.width * currentScale;
    const currentHeight = baseLayer.image.height * currentScale;
    const currentX = (canvas.width - currentWidth) / 2 + current.offsetX;
    const currentY = (canvas.height - currentHeight) / 2 + current.offsetY;
    const imageX = (cursorX - currentX) / currentScale;
    const imageY = (cursorY - currentY) / currentScale;
    const zoomDelta = Math.exp(-event.deltaY * 0.001);
    const nextZoom = Math.min(Math.max(current.zoom * zoomDelta, 1), 24);
    const nextScale = fit.scale * nextZoom;
    const nextWidth = baseLayer.image.width * nextScale;
    const nextHeight = baseLayer.image.height * nextScale;
    const centeredX = (canvas.width - nextWidth) / 2;
    const centeredY = (canvas.height - nextHeight) / 2;

    transformRef.current = {
      zoom: nextZoom,
      offsetX: cursorX - imageX * nextScale - centeredX,
      offsetY: cursorY - imageY * nextScale - centeredY
    };

    if (nextZoom === 1) {
      transformRef.current.offsetX = 0;
      transformRef.current.offsetY = 0;
    }

    draw();
  };

  return (
    <main className="viewer-page">
      <canvas ref={canvasRef} className="orthophoto-canvas" onWheel={handleWheel} />

      <aside className="layer-panel" aria-label="Orthophoto layer controls">
        {MAP_LAYERS.map((layer) => {
          const settings = layerState[layer.id];
          return (
            <div className="layer-control" key={layer.id}>
              <div className="layer-row">
                <span>{layer.label}</span>
                <button
                  className={settings.visible ? 'toggle-button is-on' : 'toggle-button'}
                  type="button"
                  onClick={() => updateLayer(layer.id, { visible: !settings.visible })}
                >
                  {settings.visible ? 'Hide' : 'Show'}
                </button>
              </div>
              <input
                aria-label={`${layer.label} opacity`}
                disabled={!settings.visible}
                max="100"
                min="0"
                onChange={handleOpacityChange(layer.id)}
                type="range"
                value={Math.round(settings.opacity * 100)}
              />
            </div>
          );
        })}
      </aside>

      {(status || error) && <div className="loading-card overlay">{error ?? status}</div>}
    </main>
  );
}
