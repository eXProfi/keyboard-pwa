# MediaPipe Tasks Vision 0.10.21

Vendored browser runtime and SIMD/non-SIMD WASM from the official npm package.
License: Apache-2.0 (LICENSE). The official npm archive SHA-512 was checked before
extracting only the six reviewed runtime/model files. Per-file SHA-256 values
and exact sources are recorded in ../../tracking-assets.json.

No CDN request occurs in the application. scripts/fetch_tracking_assets.py
restores missing files using pinned hashes; --verify performs an offline check.

Face Landmarker model version1 float16 contains BlazeFace, Face Mesh V2 and
Blendshape V2. Each official model card states Apache License, Version2.0:

- https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf
- https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf
- https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf

Camera frames and landmarks remain in browser memory and are never recorded.
