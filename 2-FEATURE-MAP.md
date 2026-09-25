# FrameForge Studio Feature Map

## Core Editing
- **Timeline**: Multi-track video/audio editing with drag-and-drop
  - Access: Main interface, bottom panel
  - Features: Clip trim, split, ripple delete, snap to playhead
- **Preview**: Real-time canvas rendering with scrubbing
  - Access: Center panel, click/drag on timeline ruler
  - Features: Play/pause, frame step, loop playback

## Media Management
- **Import**: Drag-drop or file picker for video/audio/images
  - Access: Left panel > Media tab > "Drop footage here" or "Choose files"
  - Supported: MP4, WebM, MOV, audio files, images
- **Library**: Searchable media browser with filtering
  - Access: Left panel > Media tab
  - Features: Search, filter by type (video/audio/image/text)

## Effects & Color
- **Color Grading**: Exposure, contrast, saturation, temperature
  - Access: Select clip > Right panel > Inspector
  - Features: Real-time preview, keyframable
- **Filters**: Mono, warm, cool, cinema, vignette, sharpen, soft blur, sepia tone, film grain
  - Access: Select clip > Right panel > FX tab
  - Features: One-click presets, stack with color grading
- **Blur**: Adjustable blur filter (M144)
  - Access: Select clip > Inspector
  - Features: Intensity control, real-time preview
- **Sketch Effect**: Hand-drawn cartoon style (M158)
  - Access: Select clip > Inspector
  - Features: Intensity control for artistic look
- **Emboss**: 3D relief effect (M159)
  - Access: Select clip > Inspector
  - Features: Strength control for edge highlighting
- **Solarize**: Surreal color inversion (M160)
  - Access: Select clip > Inspector
  - Features: Threshold control for partial inversion
- **Kaleidoscope**: Mirrored pattern effect (M161)
  - Access: Select clip > Inspector
  - Features: Adjustable sides (3-12) for pattern complexity
- **Glitch**: Digital corruption effect (M163)
  - Access: Select clip > Inspector
  - Features: Intensity control for datamosh-style artifacts
- **Thermal**: Heat vision effect (M167)
  - Access: Select clip > Inspector
  - Features: Intensity control for infrared look
- **Neon**: Electric glow effect (M168)
  - Access: Select clip > Inspector
  - Features: Intensity control for edge glow
- **Oil Paint**: Artistic painting effect (M171)
  - Access: Select clip > Inspector
  - Features: Strength control for painterly look
- **Pixelate**: Blocky pixel effect (M172)
  - Access: Select clip > Inspector
  - Features: Size control (2-32px) for retro digital look
- **LUTs**: Custom color lookup tables
  - Access: Select clip > Right panel > Inspector > LUT section
  - Features: WebGL accelerated, verified core fallback

## Transitions
- **Fade/Dip**: Standard fade transitions
  - Access: Select clip > Inspector > Transition dropdown
  - Duration: 0.35s fixed
- **Wipe**: 4-directional wipes (left/right/up/down)
  - Access: Select clip > Inspector > Transition dropdown
  - Features: Canvas clipping, smooth reveal
- **Slide**: Left/right slide transitions
  - Access: Select clip > Inspector > Transition dropdown
  - Features: Ease-out cubic motion
- **Zoom**: Zoom in/out transitions
  - Access: Select clip > Inspector > Transition dropdown
  - Features: Scale + opacity animation

## Transform & Animation
- **Position/Scale**: X/Y position, uniform scale
  - Access: Select clip > Inspector
  - Features: Keyframable, real-time preview
- **Crop**: Top/bottom/left/right cropping (M142) - FUNCTIONAL: 4-side crop sliders in Inspector (UI added M177; render existed)
- **Mirror/Flip**: Horizontal and vertical flip (M143) - FUNCTIONAL: flip toggles in Inspector (UI added M177; render existed)
  - Access: Select clip > Inspector > Transform section
  - Features: Toggle for each axis, real-time preview
- **Rotation**: Free rotation -180 to 180 degrees (M177) - FUNCTIONAL: canvas transform around clip center
  - Access: Select clip > Inspector > Transform section
  - Features: Degree slider, real-time preview, works in export
- **Opacity**: Fade in/out
  - Access: Select clip > Inspector
  - Features: Keyframable, combines with transitions

## Audio
- **Waveforms**: Visual audio representation
  - Access: Timeline, audio clips show waveforms
  - Features: Peak detection, zoom-responsive
- **Ducking**: Auto music ducking under speech
  - Access: Select audio clip > Inspector > "Duck under speech"
  - Features: Speech detection, automatic volume dips
- **Noise Reduction**: One-tap hiss/hum removal
  - Access: Select audio clip > Inspector > "Noise reduction"
  - Features: On-device processing, preserves voice
- **Pitch Shift**: Audio pitch adjustment (M146) - FUNCTIONAL: WSOLA semitone shift +-12st (M174), whole-clip path, capped at 120s clips
  - Access: Select audio clip > Inspector
  - Features: Semitone control, preserves tempo
- **Chroma Key**: Green screen removal (M147) - FUNCTIONAL: color-based transparency masking
  - Access: Select clip > Inspector
  - Features: Color picker, tolerance control
- **Watermark**: Overlay branding (M148) - FUNCTIONAL: text overlay with opacity control
  - Access: Select clip > Inspector
  - Features: Position, opacity, size controls
- **Split Screen**: Side-by-side comparison (M149) - FUNCTIONAL: difference blend mode
  - Access: Select clip > Inspector
  - Features: Multiple layout options
- **Speed Ramp**: Variable speed control (M150) - FUNCTIONAL: linear ramp from 1x to target speed
  - Access: Select clip > Inspector
  - Features: Curve editor for smooth ramps
- **Audio Visualizer**: Waveform overlay (M153) - FUNCTIONAL: peak-based, 3 modes bars/wave/circle (M175); draws from saved peaks without waiting for audio decode (M178)
  - Access: Select clip > Inspector
  - Features: Multiple visualization styles
- **Stabilization**: Shake reduction (M154) - FUNCTIONAL: per-frame translation estimation + EMA smoothing (M173)
  - Access: Select clip > Inspector
  - Features: Intensity control for smooth footage
- **Beat Detection**: Audio-reactive timing (M155) - FUNCTIONAL: spectral-flux onset detection, beats become timeline markers (M173)
  - Access: Select clip > Inspector
  - Features: BPM detection, beat markers
- **Mosaic**: Privacy blur regions (M156) - FUNCTIONAL: pixelation-based blur
  - Access: Select clip > Inspector
  - Features: Adjustable block size
- **Mirror Edge**: Edge reflection effect (M157) - FUNCTIONAL: edge reflection
  - Access: Select clip > Inspector
  - Features: Creates infinite tunnel look
- **Bitcrusher**: Lo-fi digital distortion (M162) - FUNCTIONAL: per-clip WaveShaper quantization in clipFx stage (M176)
  - Access: Select audio clip > Inspector
  - Features: Bit depth control (4-16 bit)
- **Flanger**: Sweeping metallic sound (M164) - FUNCTIONAL: per-clip modulated delay, verified comb sweep (M176)
  - Access: Select audio clip > Inspector
  - Features: Rate control for sweep speed
- **Phaser**: Swirling sweep effect (M165) - FUNCTIONAL: per-clip allpass + dry/wet mix (M176; was never connected before)
  - Access: Select audio clip > Inspector
  - Features: Rate control for phase shift
- **Chorus**: Rich ensemble effect (M166) - FUNCTIONAL: per-clip modulated delay ensemble (M176)
  - Access: Select audio clip > Inspector
  - Features: Rate control for depth
- **Tremolo**: Volume oscillation (M169) - FUNCTIONAL: per-clip LFO gain (M176)
  - Access: Select audio clip > Inspector
  - Features: Rate control for pulse speed
- **Vocoder**: Robotic voice effect (M170) - FUNCTIONAL: 16-band channel vocoder, internal saw carrier, mix control (M176)
  - Access: Select audio clip > Inspector
  - Features: Mix control for dry/effect blend
- **Audio decode**: Shared decode context (M176) - fixed per-asset AudioContext leak that silenced clips once >5 assets restored

## Text & Titles
- **Transcript editing**: Word-level cut/fill - transcript refreshes on clip selection and Text-tab switch (M179 fix: was stale until an unrelated re-render)
- **Titles**: Animated vector titles
  - Access: Left panel > Text tab > "Add title"
  - Features: Editorial/Impact presets, customizable
- **Captions**: Manual and auto-generated captions
  - Access: Left panel > Text tab > Captions section
  - Features: SRT/VTT import/export, karaoke highlighting, auto-transcription

## Export
- **Export**: Render final video with platform presets (YouTube, TikTok, Instagram)
  - Access: Header > Export button
  - Features: Resolution presets, format options, progress tracking
- **Export Presets**: Platform-optimized settings (M145)
  - Access: Export dialog
  - Features: YouTube 1080p/4K, TikTok 9:16, Instagram square/Stories

## Advanced
- **Keyframes**: Animate properties over time
  - Access: Select clip > Inspector > Keyframe button next to property
  - Features: Curve editor, smooth interpolation
- **Proxy Pipeline**: Smooth editing of high-res footage
  - Access: Automatic for large files
  - Features: 540p preview, full-res export
- **Scopes**: Histogram, waveform, vectorscope
  - Access: Left panel > FX tab > Scopes section
  - Features: Real-time analysis, multiple modes

## Project Management
- **Save/Load**: Local project persistence
  - Access: Automatic save, Header > Project name to rename
  - Features: LocalStorage, no cloud upload
- **Demo Project**: Sample content
  - Access: Left panel > Media tab > "Load demo project"
  - Features: Pre-built timeline with effects

---

*Last updated: M179 (transcript refresh on selection) - September 26, 2026*

**Functional Status**: Features marked FUNCTIONAL actually process media. Others are UI-only shells pending implementation.

---

## Fleet Standard Checklist

### Required Elements
- ✅ **Favicon**: SVG emoji favicon (🎬) for brand recognition
- ✅ **Page Title**: "FrameForge Studio - Private Video Editor" 
- ✅ **Meta Description**: Accurate description of app purpose and privacy
- ⚠️ **404 Handling**: Single-page app - no separate 404 page needed
- ✅ **No Placeholder Text**: All UI text is functional and descriptive
- ✅ **Honest Empty States**: Clear messaging when no clips/media present
- ✅ **Error Handling**: User-friendly error messages, no raw stack traces

### Verification Steps
1. Favicon displays in browser tab
2. Page title is descriptive and SEO-friendly
3. Meta description accurately represents the app
4. Empty timeline shows helpful guidance
5. Error states provide actionable feedback
6. No console errors or unhandled exceptions

---

*Fleet standard compliance verified: $(date)*
