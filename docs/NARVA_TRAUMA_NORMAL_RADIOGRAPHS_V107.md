# Narva trauma 1.0.7 — optional normal radiographs

Based on the exact operational APK192 source commit
`524814c5e7f03c07fb6069723f5bb85945289161`. This source-only addition does not
build or update an APK, change a server or migrate an existing exercise.

The user approved two additional, independently orderable studies on 2026-10-29:

| Patient | Study / order ID | Image | Report |
| --- | --- | --- | --- |
| PT-PELVIC-001 | P01-CXR / P01-ORD-CXR | Normal PA chest | Normal chest findings |
| PT-CHEST-001 | P02-PELVIS-XR / P02-ORD-PELVIS-XR | Normal pelvis | No acute fracture/dislocation |

No study is automatically ordered or required. Both use the existing package-owned
ordering, durable command, schema-3 staged release, restoration and bundled viewer.
Image availability is 7 simulation minutes and report availability 10 simulation
minutes from the order, matching the existing 1.0.6 radiographs. The existing
P02-CXR and P01-PELVIS-XR pathological studies, order IDs and approved reports remain.
All patient, physiology, lab, intervention and other package definitions are unchanged.
Historical package versions remain registered and immutable; existing exercise
bindings are not rebound to the new latest version.

## Assets and provenance

Source files and provenance were supplied under `wp-narva-10b1/assets/imaging/`.
Originals are unchanged. The canonical asset-ingest tool performed dry runs,
copied exact bytes to version-scoped bundled paths, recorded metadata/provenance
in `assets/imaging/manifest.json`, and generated static Metro registrations.
The package-authoring tool only rebinds existing definitions, so the new studies
are declared in the normal package module rather than overwriting another patient.

- `normal-chest-pa.jpg`: SHA-256
  `4cbbcf805291db949e4ff085ca3c7258b2823de21b2857ae684e6c91ff9a38a4`.
  [Wikimedia source](https://commons.wikimedia.org/wiki/File:Normal_posteroanterior_(PA)_chest_radiograph_(X-ray).jpg),
  Mikael Häggström, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
  Original JPEG, 1929×2207; PA, not AP.
- `normal-adult-male-pelvis.jpg`: SHA-256
  `ab363a11fea4a759f0f6457d4d139d92913044eff5481e9d3b1004d9bf7b8e34`.
  [Wikimedia source](https://commons.wikimedia.org/wiki/File:Normal_adult_male_human_pelvis.jpg),
  Cedar Sinai Medical Center of Beverly Hills, California; uploader KDS4444,
  [Public Domain Mark 1.0](https://creativecommons.org/publicdomain/mark/1.0/).
  Wikimedia-rendered JPEG, 3840×3192, negative presentation retained unchanged.

These are user-approved educational examples, not this simulated patient's actual
images. No independent clinical validation is claimed. No inversion, cropping,
anatomical editing or synthetic findings were added. Existing image provenance
is preserved separately from the clinical report text.

Because the registry binds every asset to an immutable package version, 1.0.7
also registers the exact unchanged pathological bytes with additional `v2` asset
identities. Original `v1` identities and 1.0.6 files/metadata remain untouched.
The `v2` identity denotes a new package binding, not an image modification.

## Guardrail impact and release boundary

Applicable groups: imaging, runtime and source-fidelity; package immutability,
hash freeze and restart determinism (V/W/X). No runtime algorithm or validator
changes. Historical negative checks remain; the 1.0.6 test now asserts its exact
frozen hash instead of assuming it will always be the latest package.

Required source verification includes asset verification, those guardrail groups,
full Jest (including unchanged persistence performance and Runtime Hardening),
TypeScript, ESLint and diff checks. New package-specific tests cover optional
ordering, patient/asset binding, timing boundaries, recovery and existing studies.
Physical device testing and APK acceptance are NOT_RUN in this work package.
Future device use needs a separately authorized APK build/data-preserving update
and scoped physical verification of the new studies. Existing exercises are not
silently upgraded; new 1.0.7 content requires an explicit 1.0.7 exercise binding.
