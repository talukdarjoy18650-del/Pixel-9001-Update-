"use client";

import { useState, useCallback, useRef, useEffect, type CSSProperties } from "react";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import {
  Loader2,
  UploadCloud,
  Download,
  AlertCircle,
  Video,
  FileImage,
  Layers,
  RefreshCw,
  ChevronDown,
  X,
  Share2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { generateSpongeSchematic } from "@/lib/schematic-utils";
import { processImageAsync } from "@/lib/color-science";
import { PWAInstallButton } from "@/components/pwa/pwa-install-button";

const MAX_WIDTH_BLOCKS = 600;
const DEFAULT_WIDTH_BLOCKS = 120;
const DEFAULT_BLOCK_PIXEL_SIZE = 12;
const ANIMATION_FPS = 30;
const MAX_CANVAS_EDGE = 4096;
const MAX_CANVAS_AREA = 16_777_216;
const MAX_BG_EDGE = 2560;

const resolutionOptions = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function getClampedDimensions(width: number, height: number): { width: number; height: number } {
  const safeWidth = Math.max(2, width);
  const safeHeight = Math.max(2, height);
  const maxWidth = 1920;
  const maxHeight = 1080;
  const ratio = Math.min(1, maxWidth / safeWidth, maxHeight / safeHeight);

  const evenWidth = Math.max(2, Math.floor((safeWidth * ratio) / 2) * 2);
  const evenHeight = Math.max(2, Math.floor((safeHeight * ratio) / 2) * 2);

  return { width: evenWidth, height: evenHeight };
}

function getSafePixelSize(blockWidth: number, blockHeight: number, requested: number): number {
  const clampedReq = clampInt(requested, 1, 128, DEFAULT_BLOCK_PIXEL_SIZE);
  const maxByEdge = Math.floor(
    Math.min(MAX_CANVAS_EDGE / Math.max(1, blockWidth), MAX_CANVAS_EDGE / Math.max(1, blockHeight))
  );
  const maxByArea = Math.floor(
    Math.sqrt(MAX_CANVAS_AREA / Math.max(1, blockWidth * blockHeight))
  );
  return Math.max(1, Math.min(clampedReq, maxByEdge, maxByArea));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type DecodedImage = HTMLImageElement | ImageBitmap;

function getDecodedImageDims(img: DecodedImage): { width: number; height: number } {
  if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) {
    return { width: img.width, height: img.height };
  }
  const el = img as HTMLImageElement;
  return { width: el.naturalWidth || el.width, height: el.naturalHeight || el.height };
}

function isSupportedImageFile(file: File): boolean {
  if (file.type && file.type.startsWith("image/")) return true;
  if (!file.type) {
    return /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i.test(file.name);
  }
  return false;
}

export function Blockify() {
  const { toast } = useToast();
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [backgroundImageFile, setBackgroundImageFile] = useState<File | null>(null);
  const [mainPreviewUrl, setMainPreviewUrl] = useState<string | null>(null);
  const [bgPreviewUrl, setBgPreviewUrl] = useState<string | null>(null);
  const [mainDragOver, setMainDragOver] = useState<boolean>(false);
  const [bgDragOver, setBgDragOver] = useState<boolean>(false);
  const [shakeMainDrop, setShakeMainDrop] = useState<boolean>(false);

  const [widthBlocks, setWidthBlocks] = useState<number>(DEFAULT_WIDTH_BLOCKS);
  const [blockPixelSize, setBlockPixelSize] = useState<number>(DEFAULT_BLOCK_PIXEL_SIZE);
  const [useDithering, setUseDithering] = useState<boolean>(true);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isAnimating, setIsAnimating] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [outputImageUrl, setOutputImageUrl] = useState<string | null>(null);
  const [outputVideoUrl, setOutputVideoUrl] = useState<string | null>(null);
  const [activePreviewTab, setActivePreviewTab] = useState<"image" | "video">("image");
  const [videoExt, setVideoExt] = useState<"mp4" | "webm">("mp4");
  const [schematicUrl, setSchematicUrl] = useState<string | null>(null);
  const [lastFrameUrl, setLastFrameUrl] = useState<string | null>(null);
  const [artStats, setArtStats] = useState<{
    width: number;
    height: number;
    totalBlocks: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backgroundColor, setBackgroundColor] = useState<string>("#000000");
  const [animationDuration, setAnimationDuration] = useState<number>(4);
  const [imageScale, setImageScale] = useState<number>(60);
  const [schematicOrientation, setSchematicOrientation] = useState<"vertical" | "horizontal">("vertical");
  const [schematicRotation, setSchematicRotation] = useState<number>(0);
  const [canShareFiles, setCanShareFiles] = useState<boolean>(false);

  const lastBlobUrl = useRef<string | null>(null);
  const lastVideoBlobUrl = useRef<string | null>(null);
  const lastFrameBlobUrl = useRef<string | null>(null);
  const lastSchematicBlobUrl = useRef<string | null>(null);
  const mainPreviewRef = useRef<string | null>(null);
  const bgPreviewRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const mainBlobRef = useRef<Blob | null>(null);
  const bgBlobRef = useRef<Blob | null>(null);
  const resultSectionRef = useRef<HTMLDivElement | null>(null);

  const bgImgRef = useRef<DecodedImage | null>(null);
  const blockArtData = useRef<{
    pixels: Uint8ClampedArray;
    width: number;
    height: number;
    blockIds: string[];
  } | null>(null);

  const revokeUrls = useCallback(() => {
    if (lastBlobUrl.current) URL.revokeObjectURL(lastBlobUrl.current);
    if (lastVideoBlobUrl.current) URL.revokeObjectURL(lastVideoBlobUrl.current);
    if (lastFrameBlobUrl.current) URL.revokeObjectURL(lastFrameBlobUrl.current);
    if (lastSchematicBlobUrl.current) URL.revokeObjectURL(lastSchematicBlobUrl.current);
    lastBlobUrl.current = null;
    lastVideoBlobUrl.current = null;
    lastFrameBlobUrl.current = null;
    lastSchematicBlobUrl.current = null;
    setOutputImageUrl(null);
    setOutputVideoUrl(null);
    setSchematicUrl(null);
    setLastFrameUrl(null);
    setArtStats(null);
    setActivePreviewTab("image");
    if (bgImgRef.current && typeof ImageBitmap !== "undefined" && bgImgRef.current instanceof ImageBitmap) {
      try {
        bgImgRef.current.close();
      } catch {
        // ignore
      }
    }
    bgImgRef.current = null;
    blockArtData.current = null;
  }, []);

  useEffect(() => {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof navigator.canShare === "function") {
        const probe = new File([""], "probe.png", { type: "image/png" });
        setCanShareFiles(navigator.canShare({ files: [probe] }));
      }
    } catch {
      setCanShareFiles(false);
    }
    return () => {
      abortControllerRef.current?.abort();
      revokeUrls();
      if (mainPreviewRef.current) URL.revokeObjectURL(mainPreviewRef.current);
      if (bgPreviewRef.current) URL.revokeObjectURL(bgPreviewRef.current);
    };
  }, [revokeUrls]);

  const applyMainFile = (file: File) => {
    if (!isSupportedImageFile(file)) {
      setError("Please upload a valid image file (PNG, JPG, or GIF).");
      return;
    }
    if (mainPreviewRef.current) URL.revokeObjectURL(mainPreviewRef.current);
    const preview = URL.createObjectURL(file);
    mainPreviewRef.current = preview;
    setMainPreviewUrl(preview);
    setImageFile(file);
    mainBlobRef.current = null;
    // Eagerly copy into an in-memory Blob so mobile content:// picker permissions cannot expire
    file
      .arrayBuffer()
      .then((buf) => {
        mainBlobRef.current = new Blob([buf], { type: file.type || "image/jpeg" });
      })
      .catch(() => {
        mainBlobRef.current = null;
      });
    setError(null);
    revokeUrls();
  };

  const clearMainFile = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (mainPreviewRef.current) URL.revokeObjectURL(mainPreviewRef.current);
    mainPreviewRef.current = null;
    setMainPreviewUrl(null);
    setImageFile(null);
    mainBlobRef.current = null;
    revokeUrls();
  };

  const applyBackgroundFile = (file: File) => {
    if (!isSupportedImageFile(file)) {
      setError("Please upload a valid background image file.");
      return;
    }
    if (bgPreviewRef.current) URL.revokeObjectURL(bgPreviewRef.current);
    const preview = URL.createObjectURL(file);
    bgPreviewRef.current = preview;
    setBgPreviewUrl(preview);
    setBackgroundImageFile(file);
    bgBlobRef.current = null;
    file
      .arrayBuffer()
      .then((buf) => {
        bgBlobRef.current = new Blob([buf], { type: file.type || "image/jpeg" });
      })
      .catch(() => {
        bgBlobRef.current = null;
      });
    setError(null);
    revokeUrls();
  };

  const clearBackgroundFile = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (bgPreviewRef.current) URL.revokeObjectURL(bgPreviewRef.current);
    bgPreviewRef.current = null;
    setBgPreviewUrl(null);
    setBackgroundImageFile(null);
    bgBlobRef.current = null;
    revokeUrls();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      applyMainFile(e.target.files[0]);
    }
    e.target.value = "";
  };

  const handleBackgroundFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      applyBackgroundFile(e.target.files[0]);
    }
    e.target.value = "";
  };

  const decodeViaDataUrl = (blob: Blob): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = document.createElement("img");
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Image element failed to decode data URL."));
        img.src = reader.result as string;
      };
      reader.onerror = () => reject(new Error("FileReader could not read image file."));
      reader.readAsDataURL(blob);
    });

  const decodeViaObjectUrl = (blob: Blob): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(blob);
      const img = document.createElement("img");
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Image element failed to decode object URL."));
      };
      img.src = objectUrl;
    });

  const loadImageFromFile = async (file: File, cachedBlob?: Blob | null): Promise<DecodedImage> => {
    let sourceBlob: Blob = cachedBlob || file;
    if (!cachedBlob) {
      try {
        const buf = await file.arrayBuffer();
        sourceBlob = new Blob([buf], { type: file.type || "image/jpeg" });
      } catch {
        sourceBlob = file;
      }
    }

    if (typeof createImageBitmap === "function") {
      try {
        return await createImageBitmap(sourceBlob);
      } catch {
        // Fallback below
      }
    }

    try {
      return await decodeViaDataUrl(sourceBlob);
    } catch {
      // Fallback below
    }

    try {
      return await decodeViaObjectUrl(sourceBlob);
    } catch {
      throw new Error(
        `Could not decode image "${file.name}". If this is a HEIC/RAW photo or cloud-only file, convert or save it locally as PNG or JPG first.`
      );
    }
  };

  const generateAndSetUrl = (canvas: HTMLCanvasElement): Promise<string> =>
    new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(URL.createObjectURL(blob));
        } else {
          reject(new Error("Failed to create image blob (output canvas exceeded browser limit)."));
        }
      }, "image/png");
    });

  const createFinalCanvas = useCallback(
    (blockArtCanvas: HTMLCanvasElement, bgImg?: DecodedImage | null): HTMLCanvasElement => {
      const finalCanvas = document.createElement("canvas");
      let targetWidth = blockArtCanvas.width;
      let targetHeight = blockArtCanvas.height;

      if (bgImg) {
        const { width: bgW, height: bgH } = getDecodedImageDims(bgImg);
        const bgScale = Math.min(1, MAX_BG_EDGE / Math.max(1, bgW), MAX_BG_EDGE / Math.max(1, bgH));
        targetWidth = Math.max(1, Math.round(bgW * bgScale));
        targetHeight = Math.max(1, Math.round(bgH * bgScale));
      }

      finalCanvas.width = targetWidth;
      finalCanvas.height = targetHeight;
      const finalCtx = finalCanvas.getContext("2d");
      if (!finalCtx) throw new Error("Could not get final canvas context.");

      if (bgImg) {
        finalCtx.drawImage(bgImg, 0, 0, targetWidth, targetHeight);
      } else {
        finalCtx.fillStyle = backgroundColor;
        finalCtx.fillRect(0, 0, targetWidth, targetHeight);
      }

      const safeScale = Math.max(1, Math.min(100, imageScale));
      const maxDrawWidth = targetWidth * (safeScale / 100);
      const maxDrawHeight = targetHeight * (safeScale / 100);
      const ratio = Math.min(
        maxDrawWidth / Math.max(1, blockArtCanvas.width),
        maxDrawHeight / Math.max(1, blockArtCanvas.height)
      );
      const drawWidth = Math.max(1, Math.round(blockArtCanvas.width * ratio));
      const drawHeight = Math.max(1, Math.round(blockArtCanvas.height * ratio));
      const x = Math.round((targetWidth - drawWidth) / 2);
      const y = Math.round((targetHeight - drawHeight) / 2);
      finalCtx.imageSmoothingEnabled = false;
      finalCtx.drawImage(blockArtCanvas, x, y, drawWidth, drawHeight);

      return finalCanvas;
    },
    [backgroundColor, imageScale]
  );

  const convertImageToCanvas = (
    pixelData: Uint8ClampedArray,
    width: number,
    height: number
  ): { canvas: HTMLCanvasElement; usedPixelSize: number } => {
    const processedImageData = new ImageData(new Uint8ClampedArray(pixelData), width, height);
    const safeBlockPixelSize = getSafePixelSize(width, height, blockPixelSize);
    const outputWidth = width * safeBlockPixelSize;
    const outputHeight = height * safeBlockPixelSize;

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = outputWidth;
    outputCanvas.height = outputHeight;
    const outputCtx = outputCanvas.getContext("2d");
    if (!outputCtx) throw new Error("Could not get 2D context for output canvas.");
    outputCtx.imageSmoothingEnabled = false;

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext("2d");
    if (!tempCtx) throw new Error("Could not get temp 2D context.");
    tempCtx.putImageData(processedImageData, 0, 0);
    outputCtx.drawImage(tempCanvas, 0, 0, outputWidth, outputHeight);

    return { canvas: outputCanvas, usedPixelSize: safeBlockPixelSize };
  };

  const handleConvert = useCallback(async () => {
    if (!imageFile) {
      setError("Please upload a main image first.");
      setShakeMainDrop(true);
      setTimeout(() => setShakeMainDrop(false), 260);
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsProcessing(true);
    setProgress(0);
    setError(null);
    revokeUrls();

    let img: DecodedImage | null = null;
    try {
      img = await loadImageFromFile(imageFile, mainBlobRef.current);
      const { width: naturalW, height: naturalH } = getDecodedImageDims(img);
      if (!naturalW || !naturalH) {
        throw new Error("Uploaded image has zero width or height.");
      }

      const bgImg = backgroundImageFile
        ? await loadImageFromFile(backgroundImageFile, bgBlobRef.current)
        : undefined;
      if (bgImg) {
        const { width: bgW, height: bgH } = getDecodedImageDims(bgImg);
        if (!bgW || !bgH) {
          throw new Error("Background image has zero width or height.");
        }
      }

      const clampedWidth = clampInt(widthBlocks, 1, MAX_WIDTH_BLOCKS, DEFAULT_WIDTH_BLOCKS);
      const aspectRatio = naturalH / naturalW;
      const clampedHeight = Math.max(1, Math.round(clampedWidth * aspectRatio));

      if (clampedWidth !== widthBlocks) setWidthBlocks(clampedWidth);

      const smallCanvas = document.createElement("canvas");
      smallCanvas.width = clampedWidth;
      smallCanvas.height = clampedHeight;
      const smallCtx = smallCanvas.getContext("2d", { willReadFrequently: true });
      if (!smallCtx) throw new Error("Could not get 2D context for canvas.");
      smallCtx.drawImage(img, 0, 0, clampedWidth, clampedHeight);
      const imageData = smallCtx.getImageData(0, 0, clampedWidth, clampedHeight);

      const { pixels: finalSrgbPixels, blockIds, totalBlocks } = await processImageAsync(
        imageData,
        useDithering,
        (pct) => setProgress(pct),
        controller.signal
      );

      if (controller.signal.aborted) return;

      blockArtData.current = {
        pixels: finalSrgbPixels,
        width: clampedWidth,
        height: clampedHeight,
        blockIds,
      };
      bgImgRef.current = bgImg || null;

      const { canvas: convertedCanvas, usedPixelSize } = convertImageToCanvas(
        finalSrgbPixels,
        clampedWidth,
        clampedHeight
      );

      const finalCanvas = createFinalCanvas(convertedCanvas, bgImg);
      const url = await generateAndSetUrl(finalCanvas);

      setOutputImageUrl(url);
      lastBlobUrl.current = url;
      setArtStats({ width: clampedWidth, height: clampedHeight, totalBlocks });
      setActivePreviewTab("image");

      // Generate Sponge Schematic
      const schemBlob = generateSpongeSchematic(
        finalSrgbPixels,
        clampedWidth,
        clampedHeight,
        blockIds,
        schematicOrientation,
        schematicRotation
      );
      const schemUrl = URL.createObjectURL(schemBlob);
      setSchematicUrl(schemUrl);
      lastSchematicBlobUrl.current = schemUrl;

      toast({
        title: "Image Generated!",
        description:
          usedPixelSize < blockPixelSize
            ? `Minecraft block art ready (pixel size auto-capped to ${usedPixelSize}px for browser memory safety).`
            : "Your Minecraft block art and .schem file are ready.",
      });

      requestAnimationFrame(() => {
        resultSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const message = e instanceof Error ? e.message : "An unknown error occurred during conversion.";
      setError(message);
      toast({ variant: "destructive", title: "Image Generation Failed", description: message });
    } finally {
      if (img && typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) {
        try {
          img.close();
        } catch {
          // ignore
        }
      }
      setIsProcessing(false);
      setProgress(0);
    }
  }, [
    imageFile,
    backgroundImageFile,
    widthBlocks,
    useDithering,
    createFinalCanvas,
    blockPixelSize,
    toast,
    schematicOrientation,
    schematicRotation,
    revokeUrls,
  ]);

  // Keep .schem up-to-date if orientation or rotation changes after generation
  useEffect(() => {
    if (!blockArtData.current) return;
    try {
      const { pixels, width, height, blockIds } = blockArtData.current;
      const schemBlob = generateSpongeSchematic(
        pixels,
        width,
        height,
        blockIds,
        schematicOrientation,
        schematicRotation
      );
      if (lastSchematicBlobUrl.current) URL.revokeObjectURL(lastSchematicBlobUrl.current);
      const schemUrl = URL.createObjectURL(schemBlob);
      lastSchematicBlobUrl.current = schemUrl;
      setSchematicUrl(schemUrl);
    } catch {
      // ignore
    }
  }, [schematicOrientation, schematicRotation]);

  const handleAnimate = useCallback(async () => {
    if (!blockArtData.current) {
      setError("Please generate an image first before animating.");
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsAnimating(true);
    setProgress(0);
    setError(null);
    setOutputVideoUrl(null);
    setLastFrameUrl(null);
    if (lastVideoBlobUrl.current) URL.revokeObjectURL(lastVideoBlobUrl.current);
    if (lastFrameBlobUrl.current) URL.revokeObjectURL(lastFrameBlobUrl.current);
    lastVideoBlobUrl.current = null;
    lastFrameBlobUrl.current = null;

    let videoEncoder: VideoEncoder | null = null;

    try {
      const { pixels, width: blockWidth, height: blockHeight } = blockArtData.current;
      const sourceBg = bgImgRef.current;

      const safeBlockPixelSize = getSafePixelSize(blockWidth, blockHeight, blockPixelSize);
      const artTotalWidth = blockWidth * safeBlockPixelSize;
      const artTotalHeight = blockHeight * safeBlockPixelSize;

      const sourceBgDims = sourceBg ? getDecodedImageDims(sourceBg) : null;
      const targetW = sourceBgDims ? sourceBgDims.width : Math.max(480, artTotalWidth);
      const targetH = sourceBgDims ? sourceBgDims.height : Math.max(360, artTotalHeight);
      const clamped = getClampedDimensions(targetW, targetH);

      const frameCanvas = document.createElement("canvas");
      frameCanvas.width = clamped.width;
      frameCanvas.height = clamped.height;
      const frameCtx = frameCanvas.getContext("2d", { alpha: false });
      if (!frameCtx) throw new Error("Could not create frame context.");

      let nonAirCount = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] > 0) nonAirCount++;
      }

      if (nonAirCount === 0) {
        throw new Error("Image has no opaque pixels to animate.");
      }

      const orderX = new Uint16Array(nonAirCount);
      const orderY = new Uint16Array(nonAirCount);
      let cursor = 0;

      for (let y = blockHeight - 1; y >= 0; y--) {
        if ((blockHeight - 1 - y) % 2 === 0) {
          for (let x = blockWidth - 1; x >= 0; x--) {
            if (pixels[(y * blockWidth + x) * 4 + 3] > 0) {
              orderX[cursor] = x;
              orderY[cursor] = y;
              cursor++;
            }
          }
        } else {
          for (let x = 0; x < blockWidth; x++) {
            if (pixels[(y * blockWidth + x) * 4 + 3] > 0) {
              orderX[cursor] = x;
              orderY[cursor] = y;
              cursor++;
            }
          }
        }
      }

      const safeDuration = clampInt(animationDuration, 1, 30, 4);
      const totalFrames = Math.max(ANIMATION_FPS, Math.round(safeDuration * ANIMATION_FPS));

      const animationArtCanvas = document.createElement("canvas");
      animationArtCanvas.width = blockWidth;
      animationArtCanvas.height = blockHeight;
      const animArtCtx = animationArtCanvas.getContext("2d");
      if (!animArtCtx) throw new Error("Could not get animation art context.");

      const safeScale = Math.max(1, Math.min(100, imageScale));
      const maxDrawWidth = frameCanvas.width * (safeScale / 100);
      const maxDrawHeight = frameCanvas.height * (safeScale / 100);
      const ratio = Math.min(maxDrawWidth / blockWidth, maxDrawHeight / blockHeight);
      const drawWidth = Math.max(1, Math.round(blockWidth * ratio));
      const drawHeight = Math.max(1, Math.round(blockHeight * ratio));
      const drawX = Math.round((frameCanvas.width - drawWidth) / 2);
      const drawY = Math.round((frameCanvas.height - drawHeight) / 2);

      const drawFrame = (startPixel: number, endPixel: number) => {
        for (let p = startPixel; p < endPixel; p++) {
          const px = orderX[p];
          const py = orderY[p];
          const sourcePixelIndex = (py * blockWidth + px) * 4;
          const r = pixels[sourcePixelIndex];
          const g = pixels[sourcePixelIndex + 1];
          const b = pixels[sourcePixelIndex + 2];
          animArtCtx.fillStyle = `rgb(${r},${g},${b})`;
          animArtCtx.fillRect(px, py, 1, 1);
        }

        frameCtx.imageSmoothingEnabled = false;
        if (sourceBg) {
          frameCtx.drawImage(sourceBg, 0, 0, frameCanvas.width, frameCanvas.height);
        } else {
          frameCtx.fillStyle = backgroundColor;
          frameCtx.fillRect(0, 0, frameCanvas.width, frameCanvas.height);
        }
        frameCtx.drawImage(animationArtCanvas, drawX, drawY, drawWidth, drawHeight);
      };

      let selectedConfig: VideoEncoderConfig | null = null;
      if (typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined") {
        const codecs = ["avc1.42002A", "avc1.42001F", "avc1.4d002a", "avc1.640028", "avc1.42E01E"];
        const bitrate = Math.min(
          5_000_000,
          Math.max(1_500_000, Math.round(frameCanvas.width * frameCanvas.height * 2.5))
        );
        for (const codec of codecs) {
          const candidate: VideoEncoderConfig = {
            codec,
            width: frameCanvas.width,
            height: frameCanvas.height,
            bitrate,
            framerate: ANIMATION_FPS,
          };
          try {
            const support = await VideoEncoder.isConfigSupported(candidate);
            if (support.supported) {
              selectedConfig = candidate;
              break;
            }
          } catch {
            // try next profile
          }
        }
      }

      if (selectedConfig) {
        const muxer = new Muxer({
          target: new ArrayBufferTarget(),
          video: {
            codec: "avc",
            width: frameCanvas.width,
            height: frameCanvas.height,
          },
          firstTimestampBehavior: "offset",
        });

        let encoderFailure: Error | null = null;
        videoEncoder = new VideoEncoder({
          output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
          error: (e) => {
            encoderFailure = e instanceof Error ? e : new Error(String(e));
          },
        });
        videoEncoder.configure(selectedConfig);

        let pixelsPlaced = 0;
        const frameDurationUs = Math.round(1_000_000 / ANIMATION_FPS);

        for (let frameCount = 0; frameCount < totalFrames; frameCount++) {
          if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
          if (encoderFailure) throw encoderFailure;

          while (videoEncoder.encodeQueueSize > 5) {
            if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
            if (encoderFailure) throw encoderFailure;
            await sleep(12);
          }

          const animationProgress = (frameCount + 1) / totalFrames;
          const endPixel = Math.min(Math.round(animationProgress * nonAirCount), nonAirCount);

          drawFrame(pixelsPlaced, endPixel);
          pixelsPlaced = endPixel;

          const videoFrame = new VideoFrame(frameCanvas, {
            timestamp: Math.round((frameCount * 1_000_000) / ANIMATION_FPS),
            duration: frameDurationUs,
          });
          try {
            videoEncoder.encode(videoFrame, {
              keyFrame: frameCount % (ANIMATION_FPS * 2) === 0,
            });
          } finally {
            videoFrame.close();
          }

          setProgress(Math.round(((frameCount + 1) / totalFrames) * 100));
          await sleep(0);
        }

        if (encoderFailure) throw encoderFailure;
        await videoEncoder.flush();
        muxer.finalize();

        const { buffer } = muxer.target;
        const blob = new Blob([buffer], { type: "video/mp4" });
        const videoUrl = URL.createObjectURL(blob);
        const lastFrame = await generateAndSetUrl(frameCanvas);

        setLastFrameUrl(lastFrame);
        lastFrameBlobUrl.current = lastFrame;
        setVideoExt("mp4");
        setOutputVideoUrl(videoUrl);
        lastVideoBlobUrl.current = videoUrl;
        setActivePreviewTab("video");
        toast({ title: "Animation Generated!", description: "Your build video is ready." });

        requestAnimationFrame(() => {
          resultSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      } else if (typeof MediaRecorder !== "undefined" && typeof frameCanvas.captureStream === "function") {
        const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : "video/webm";
        const stream = frameCanvas.captureStream(ANIMATION_FPS);
        const recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: 4_000_000,
        });
        const chunks: BlobPart[] = [];
        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) chunks.push(ev.data);
        };
        const stopped = new Promise<Blob>((resolve, reject) => {
          recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
          recorder.onerror = () => reject(new Error("Video recording failed."));
        });

        recorder.start();
        let pixelsPlaced = 0;
        const intervalMs = 1000 / ANIMATION_FPS;

        for (let frameCount = 0; frameCount < totalFrames; frameCount++) {
          if (controller.signal.aborted) {
            recorder.stop();
            throw new DOMException("Aborted", "AbortError");
          }
          const animationProgress = (frameCount + 1) / totalFrames;
          const endPixel = Math.min(Math.round(animationProgress * nonAirCount), nonAirCount);
          drawFrame(pixelsPlaced, endPixel);
          pixelsPlaced = endPixel;
          setProgress(Math.round(((frameCount + 1) / totalFrames) * 100));
          await sleep(intervalMs);
        }

        recorder.stop();
        const blob = await stopped;
        const videoUrl = URL.createObjectURL(blob);
        const lastFrame = await generateAndSetUrl(frameCanvas);

        setLastFrameUrl(lastFrame);
        lastFrameBlobUrl.current = lastFrame;
        setVideoExt("webm");
        setOutputVideoUrl(videoUrl);
        lastVideoBlobUrl.current = videoUrl;
        setActivePreviewTab("video");
        toast({ title: "Animation Generated!", description: "Your build video is ready." });

        requestAnimationFrame(() => {
          resultSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      } else {
        setError("Video encoding configuration not supported by this browser.");
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const message = e instanceof Error ? e.message : "An unknown error occurred during animation.";
      setError(message);
    } finally {
      if (videoEncoder && videoEncoder.state !== "closed") {
        try {
          videoEncoder.close();
        } catch {
          // ignore
        }
      }
      setIsAnimating(false);
      setProgress(0);
    }
  }, [animationDuration, toast, backgroundColor, blockPixelSize, imageScale]);

  const handleFullRefresh = useCallback(() => {
    abortControllerRef.current?.abort();
    revokeUrls();
    window.location.reload();
  }, [revokeUrls]);

  const handleShareFile = useCallback(
    async (blobUrl: string, filename: string, mimeType: string, title: string) => {
      try {
        const res = await fetch(blobUrl);
        const blob = await res.blob();
        const file = new File([blob], filename, { type: mimeType });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            title,
            files: [file],
          });
        }
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        toast({
          variant: "destructive",
          title: "Share unavailable",
          description: "Use the Download button to save the file directly to your phone.",
        });
      }
    },
    [toast]
  );

  const scalePercent = `${Math.max(0, Math.min(100, ((imageScale - 10) / 90) * 100))}%`;
  const isPresetResolution = resolutionOptions.includes(widthBlocks);

  return (
    <section className="mc-card mx-auto w-full max-w-[500px]">
      <div className="mc-grass" aria-hidden="true" />
      <div className="px-[22px] pb-7 pt-6">
        <div className="-mt-1.5 mb-3 flex flex-wrap items-center justify-between gap-2.5">
          <PWAInstallButton />
          <button
            type="button"
            onClick={handleFullRefresh}
            className="mc-refresh ml-auto"
            title="Refresh full app"
            aria-label="Refresh full app"
          >
            <RefreshCw className="h-[20px] w-[20px] shrink-0" style={{ color: "var(--lapis)" }} />
            <span className="whitespace-nowrap">Refresh</span>
          </button>
        </div>

        <h1 className="mc-title mb-3.5 mt-1.5">Minecraft Pixel Art Generator</h1>
        <p className="mb-7 text-center text-[17px] leading-[1.4] text-[var(--mc-muted)]">
          Ultimate Edition: Convert images into block art and Sponge Schematics.
        </p>

        {error && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-3 rounded-lg border-[3px] border-[var(--mc-outline)] bg-[color-mix(in_srgb,var(--redstone)_14%,var(--mc-card))] p-3.5 text-sm font-semibold text-[var(--mc-ink)]"
          >
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--redstone)]" />
            <div>
              <p className="font-bold text-[var(--redstone)]">Something went wrong</p>
              <p className="mt-0.5 leading-snug">{error}</p>
            </div>
          </div>
        )}

        {/* 1. Upload Main Image */}
        <div className="mb-6">
          <span className="mc-label" style={{ "--c": "var(--grass)" } as CSSProperties}>
            1. Upload Main Image
          </span>
          <label
            htmlFor="image-upload"
            onDragEnter={(e) => {
              e.preventDefault();
              setMainDragOver(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setMainDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setMainDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setMainDragOver(false);
              if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                applyMainFile(e.dataTransfer.files[0]);
              }
            }}
            className={`mc-drop min-h-[170px] px-3 py-6 ${mainDragOver ? "over" : ""} ${
              shakeMainDrop ? "animate-mc-shake" : ""
            }`}
            style={{ "--c": "var(--grass)" } as CSSProperties}
          >
            <input
              id="image-upload"
              type="file"
              className="hidden"
              accept="image/*"
              onChange={handleFileChange}
            />
            {mainPreviewUrl ? (
              <>
                <img
                  src={mainPreviewUrl}
                  alt={imageFile ? `Preview of ${imageFile.name}` : "Uploaded main image"}
                  referrerPolicy="no-referrer"
                  className="absolute inset-0 h-full w-full bg-[var(--mc-field)] object-contain p-2"
                  style={{ imageRendering: "pixelated" }}
                />
                <button
                  type="button"
                  onClick={clearMainFile}
                  aria-label="Remove main image"
                  title="Remove main image"
                  className="absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded border-2 border-[var(--mc-outline)] bg-[var(--mc-card)] text-[var(--mc-ink)] shadow-sm hover:bg-[var(--mc-field)]"
                >
                  <X className="h-4 w-4" />
                </button>
                {imageFile && (
                  <span className="absolute bottom-2 left-2 right-2 z-10 truncate rounded border-2 border-[var(--mc-outline)] bg-[var(--mc-card)]/95 px-2.5 py-1 text-xs font-bold text-[var(--mc-ink)]">
                    {imageFile.name}
                  </span>
                )}
              </>
            ) : (
              <>
                <UploadCloud
                  className="mb-1 h-12 w-12"
                  style={{ color: "var(--grass-dark)" }}
                  strokeWidth={1.8}
                />
                <span className="text-[18px] font-semibold text-[var(--mc-ink)]">
                  Click to upload or drag and drop
                </span>
                <span className="text-[15px]">PNG, JPG, or GIF</span>
              </>
            )}
          </label>
        </div>

        {/* 2. Choose Background */}
        <div className="mb-6">
          <span className="mc-label" style={{ "--c": "var(--lapis)" } as CSSProperties}>
            2. Choose Background
          </span>
          <div className="mb-4 flex items-center gap-3.5 text-[18px] font-semibold">
            <input
              id="bg-color"
              type="color"
              value={backgroundColor}
              onChange={(e) => setBackgroundColor(e.target.value)}
              aria-label="Background color"
              className="mc-swatch"
            />
            <label htmlFor="bg-color" className="cursor-pointer">
              Color
            </label>
            <span className="ml-auto font-mono text-sm font-semibold tabular-nums text-[var(--mc-muted)]">
              {backgroundColor.toUpperCase()}
            </span>
          </div>

          <div className="mc-or">or</div>

          <label
            htmlFor="bgimage-upload"
            onDragEnter={(e) => {
              e.preventDefault();
              setBgDragOver(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setBgDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setBgDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setBgDragOver(false);
              if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                applyBackgroundFile(e.dataTransfer.files[0]);
              }
            }}
            className={`mc-drop min-h-[96px] px-3 py-4 text-[16px] font-semibold ${
              bgDragOver ? "over" : ""
            }`}
            style={{ "--c": "var(--lapis)" } as CSSProperties}
          >
            <input
              id="bgimage-upload"
              type="file"
              className="hidden"
              accept="image/*"
              onChange={handleBackgroundFileChange}
            />
            {bgPreviewUrl ? (
              <>
                <img
                  src={bgPreviewUrl}
                  alt={
                    backgroundImageFile
                      ? `Preview of ${backgroundImageFile.name}`
                      : "Uploaded background image"
                  }
                  referrerPolicy="no-referrer"
                  className="absolute inset-0 h-full w-full bg-[var(--mc-field)] object-contain p-1.5"
                  style={{ imageRendering: "pixelated" }}
                />
                <button
                  type="button"
                  onClick={clearBackgroundFile}
                  aria-label="Remove background image"
                  title="Remove background image"
                  className="absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded border-2 border-[var(--mc-outline)] bg-[var(--mc-card)] text-[var(--mc-ink)] shadow-sm hover:bg-[var(--mc-field)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                {backgroundImageFile && (
                  <span className="absolute bottom-1.5 left-2 right-2 z-10 truncate rounded border-2 border-[var(--mc-outline)] bg-[var(--mc-card)]/95 px-2 py-0.5 text-xs font-bold text-[var(--mc-ink)]">
                    {backgroundImageFile.name}
                  </span>
                )}
              </>
            ) : (
              <span>Upload background image</span>
            )}
          </label>
        </div>

        {/* Resolution */}
        <div className="mb-6" style={{ "--c": "var(--diamond)" } as CSSProperties}>
          <label htmlFor="resolution-tier" className="mc-label">
            Resolution
          </label>
          <div className="relative">
            <select
              id="resolution-tier"
              value={isPresetResolution ? String(widthBlocks) : ""}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (!Number.isNaN(val) && val > 0) setWidthBlocks(val);
              }}
              className={`mc-field-input appearance-none pr-12 ${
                !isPresetResolution ? "text-[var(--mc-muted)]" : ""
              }`}
            >
              <option value="" disabled>
                Select resolution
              </option>
              {resolutionOptions.map((res) => (
                <option key={res} value={String(res)}>
                  {res} × Auto
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-4 top-1/2 h-[22px] w-[22px] -translate-y-1/2"
              style={{ color: "var(--diamond)" }}
              strokeWidth={2.4}
            />
          </div>
        </div>

        {/* Width in Blocks (Custom) */}
        <div className="mb-6" style={{ "--c": "var(--gold)" } as CSSProperties}>
          <label htmlFor="width-blocks" className="mc-label">
            Width in Blocks (Custom)
          </label>
          <input
            id="width-blocks"
            type="number"
            min={1}
            max={MAX_WIDTH_BLOCKS}
            value={widthBlocks || ""}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              setWidthBlocks(
                Number.isNaN(val) ? 0 : Math.min(MAX_WIDTH_BLOCKS, Math.max(0, val))
              );
            }}
            onBlur={() =>
              setWidthBlocks((prev) => clampInt(prev, 1, MAX_WIDTH_BLOCKS, DEFAULT_WIDTH_BLOCKS))
            }
            className="mc-field-input tabular-nums"
          />
        </div>

        {/* Preview Pixel Size */}
        <div className="mb-6" style={{ "--c": "var(--redstone)" } as CSSProperties}>
          <label htmlFor="block-pixel-size" className="mc-label">
            Preview Pixel Size
          </label>
          <input
            id="block-pixel-size"
            type="number"
            min={4}
            max={128}
            value={blockPixelSize || ""}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              setBlockPixelSize(Number.isNaN(val) ? 0 : Math.min(128, Math.max(0, val)));
            }}
            onBlur={() =>
              setBlockPixelSize((prev) => clampInt(prev, 4, 128, DEFAULT_BLOCK_PIXEL_SIZE))
            }
            className="mc-field-input tabular-nums"
          />
        </div>

        {/* Animation Duration */}
        <div className="mb-6" style={{ "--c": "var(--amethyst)" } as CSSProperties}>
          <label htmlFor="animation-duration" className="mc-label">
            Animation Duration (s)
          </label>
          <input
            id="animation-duration"
            type="number"
            min={1}
            max={30}
            value={animationDuration || ""}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              setAnimationDuration(Number.isNaN(val) ? 0 : Math.min(30, Math.max(0, val)));
            }}
            onBlur={() => setAnimationDuration((prev) => clampInt(prev, 1, 30, 4))}
            className="mc-field-input tabular-nums"
          />
        </div>

        {/* Schematic Layout */}
        <div className="mb-6" style={{ "--c": "var(--grass)" } as CSSProperties}>
          <label htmlFor="schematic-layout" className="mc-label">
            Schematic Layout
          </label>
          <div className="relative">
            <select
              id="schematic-layout"
              value={schematicOrientation}
              onChange={(e) =>
                setSchematicOrientation(e.target.value as "vertical" | "horizontal")
              }
              className="mc-field-input appearance-none pr-12"
            >
              <option value="vertical">Vertical (Wall)</option>
              <option value="horizontal">Horizontal (Floor)</option>
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-4 top-1/2 h-[22px] w-[22px] -translate-y-1/2"
              style={{ color: "var(--grass)" }}
              strokeWidth={2.4}
            />
          </div>
        </div>

        {/* Schematic Rotation */}
        <div className="mb-6" style={{ "--c": "var(--lapis)" } as CSSProperties}>
          <label htmlFor="schematic-rotation" className="mc-label">
            Schematic Rotation
          </label>
          <div className="relative">
            <select
              id="schematic-rotation"
              value={String(schematicRotation)}
              onChange={(e) => setSchematicRotation(Number(e.target.value))}
              className="mc-field-input appearance-none pr-12"
            >
              <option value="0">0°</option>
              <option value="90">90°</option>
              <option value="180">180°</option>
              <option value="270">270°</option>
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-4 top-1/2 h-[22px] w-[22px] -translate-y-1/2"
              style={{ color: "var(--lapis)" }}
              strokeWidth={2.4}
            />
          </div>
        </div>

        {/* Image Scale Slider */}
        <div className="mb-6" style={{ "--c": "var(--gold)" } as CSSProperties}>
          <label htmlFor="image-scale" className="mc-label tabular-nums">
            Image Scale ({imageScale}%)
          </label>
          <input
            id="image-scale"
            type="range"
            min={10}
            max={100}
            step={1}
            value={imageScale}
            onChange={(e) => setImageScale(Number(e.target.value))}
            className="mc-range"
            style={{ "--pct": scalePercent } as CSSProperties}
          />
        </div>

        {/* Dithering Toggle */}
        <label
          htmlFor="dithering-switch"
          className="mb-7 mt-1.5 flex cursor-pointer items-center gap-4 text-[18px] font-semibold"
        >
          <input
            id="dithering-switch"
            type="checkbox"
            checked={useDithering}
            onChange={(e) => setUseDithering(e.target.checked)}
            className="mc-toggle-input sr-only"
          />
          <span className="mc-toggle-track" aria-hidden="true">
            <span className="mc-toggle-knob" />
          </span>
          <span>Enable Dithering (smoother gradients)</span>
        </label>

        {/* Progress Bar */}
        {(isProcessing || isAnimating) && (
          <div className="mb-5 space-y-2 rounded-lg border-[3px] border-[var(--mc-outline)] bg-[var(--mc-field)] p-3">
            <div className="flex items-center justify-between text-sm font-bold text-[var(--mc-ink)]">
              <span>{isAnimating ? "Rendering build animation..." : "Converting to Minecraft blocks..."}</span>
              <span className="tabular-nums">{progress}%</span>
            </div>
            <div className="h-3.5 w-full overflow-hidden rounded border-2 border-[var(--mc-outline)] bg-[var(--mc-card)]">
              <div
                className="h-full bg-[var(--grass)] transition-[width] duration-150"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Primary Action Buttons */}
        <button
          type="button"
          onClick={handleConvert}
          disabled={isProcessing || isAnimating}
          className="mc-btn mc-btn-art"
        >
          {isProcessing ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin" />
              <span>Processing...</span>
            </>
          ) : (
            <span>Generate Art</span>
          )}
        </button>

        <button
          type="button"
          onClick={handleAnimate}
          disabled={isAnimating || isProcessing || !outputImageUrl}
          className="mc-btn mc-btn-video mt-[18px]"
        >
          {isAnimating ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin" />
              <span>Generating Video...</span>
            </>
          ) : (
            <>
              <Video className="h-7 w-7" strokeWidth={2} />
              <span>Generate Video</span>
            </>
          )}
        </button>

        {/* Result Preview & Downloads */}
        {(outputImageUrl || outputVideoUrl) && (
          <div ref={resultSectionRef} className="mc-result mt-7 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {artStats && (
                <p className="text-sm font-bold tabular-nums text-[var(--mc-ink)]">
                  {artStats.width} × {artStats.height} blocks
                  <span className="mx-1.5 text-[var(--mc-muted)]" aria-hidden="true">
                    ·
                  </span>
                  {artStats.totalBlocks.toLocaleString()} blocks placed
                </p>
              )}

              {outputImageUrl && outputVideoUrl && (
                <div className="flex items-center gap-1 rounded-md border-2 border-[var(--mc-outline)] bg-[var(--mc-card)] p-0.5">
                  <button
                    type="button"
                    onClick={() => setActivePreviewTab("image")}
                    className={`rounded px-2.5 py-1 text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                      activePreviewTab === "image"
                        ? "bg-[var(--grass)] text-white"
                        : "text-[var(--mc-muted)] hover:text-[var(--mc-ink)]"
                    }`}
                  >
                    Image
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivePreviewTab("video")}
                    className={`rounded px-2.5 py-1 text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                      activePreviewTab === "video"
                        ? "bg-[var(--redstone)] text-white"
                        : "text-[var(--mc-muted)] hover:text-[var(--mc-ink)]"
                    }`}
                  >
                    Video
                  </button>
                </div>
              )}
            </div>

            <div className="flex justify-center overflow-auto rounded border-2 border-[var(--mc-outline)] bg-[var(--mc-card)] p-2">
              {activePreviewTab === "video" && outputVideoUrl ? (
                <video
                  src={outputVideoUrl}
                  controls
                  autoPlay
                  loop
                  className="max-h-[60vh] max-w-full rounded object-contain"
                />
              ) : (
                outputImageUrl && (
                  <img
                    src={outputImageUrl}
                    alt="Minecraft block art preview"
                    referrerPolicy="no-referrer"
                    className="h-auto max-w-full object-contain"
                    style={{ imageRendering: "pixelated" }}
                  />
                )
              )}
            </div>

            <div className="flex flex-wrap justify-center gap-3 pt-1">
              {outputImageUrl && (
                <a
                  href={outputImageUrl}
                  download="blockified-art.png"
                  className="mc-btn-download primary"
                >
                  <Download className="h-4 w-4 shrink-0" />
                  <span className="whitespace-nowrap">Download PNG</span>
                </a>
              )}
              {outputImageUrl && canShareFiles && (
                <button
                  type="button"
                  onClick={() =>
                    handleShareFile(
                      outputImageUrl,
                      "blockified-art.png",
                      "image/png",
                      "Minecraft Pixel Art"
                    )
                  }
                  className="mc-btn-download secondary"
                >
                  <Share2 className="h-4 w-4 shrink-0" />
                  <span className="whitespace-nowrap">Share PNG</span>
                </button>
              )}
              {schematicUrl && (
                <a
                  href={schematicUrl}
                  download="blockified-art.schem"
                  className="mc-btn-download secondary"
                >
                  <Layers className="h-4 w-4 shrink-0" />
                  <span className="whitespace-nowrap">Download .schem</span>
                </a>
              )}
              {schematicUrl && canShareFiles && (
                <button
                  type="button"
                  onClick={() =>
                    handleShareFile(
                      schematicUrl,
                      "blockified-art.schem",
                      "application/octet-stream",
                      "Minecraft Schematic (.schem)"
                    )
                  }
                  className="mc-btn-download secondary"
                >
                  <Share2 className="h-4 w-4 shrink-0" />
                  <span className="whitespace-nowrap">Share .schem</span>
                </button>
              )}
              {outputVideoUrl && (
                <a
                  href={outputVideoUrl}
                  download={`block-build-animation.${videoExt}`}
                  className="mc-btn-download primary"
                >
                  <Download className="h-4 w-4 shrink-0" />
                  <span className="whitespace-nowrap">Download {videoExt.toUpperCase()}</span>
                </a>
              )}
              {outputVideoUrl && canShareFiles && (
                <button
                  type="button"
                  onClick={() =>
                    handleShareFile(
                      outputVideoUrl,
                      `block-build-animation.${videoExt}`,
                      videoExt === "mp4" ? "video/mp4" : "video/webm",
                      "Minecraft Build Animation"
                    )
                  }
                  className="mc-btn-download secondary"
                >
                  <Share2 className="h-4 w-4 shrink-0" />
                  <span className="whitespace-nowrap">Share {videoExt.toUpperCase()}</span>
                </button>
              )}
              {lastFrameUrl && (
                <a
                  href={lastFrameUrl}
                  download="block-art-final-frame.png"
                  className="mc-btn-download secondary"
                >
                  <FileImage className="h-4 w-4 shrink-0" />
                  <span className="whitespace-nowrap">Download Last Frame</span>
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
