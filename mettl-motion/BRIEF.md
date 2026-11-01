# Mettl Motion: brief

## Improved prompt

Build **Mettl Motion**, a reusable 3D exercise-demonstration engine for the Mettl training app (Mattr family style).

- **Bodies:** realistic, licence-clean human meshes, male and female, sharing one skeleton.
- **Exercises are data:** keyframed anatomical joint angles, constraints (feet planted, hands on the equipment), equipment, muscle activation and coaching cues. Adding an exercise means writing a file, not code.
- **Rendering:** a calm, matte body in simple training kit. Working muscles glow (primary vs secondary), with intensity that follows the rep.
- **Camera:** slow auto-orbit, drag to rotate, preset views (front, side, back, 3/4). Play, pause, scrub and tempo controls.
- **Equipment:** selectable where the exercise allows it (barbell, dumbbells, kettlebell), with real-world dimensions.
- **First deliverable:**
  - the engine;
  - the Romanian deadlift, authored to NSCA technique and reviewed by a strength-coach advisor;
  - a viewer in Mattr style, reviewed by a designer;
  - objectives and acceptance tests.
- **Checking:** render frames from several angles and review them before shipping.

## User's job

"Before my first set I want to see what this movement looks like, what moves and what stays still, and where I should feel it. I want that in under ten seconds, at the gym, holding the phone in one hand."

## Objectives (from first principles)

1. **Correct.** Joint angles, bar path, depth and tempo match coaching standards (NSCA). The coach advisor signs off each exercise.
2. **Legible in 3 seconds.** At phone size, the body, the movement and the highlighted muscles read at a glance. The highlight answers "where should I feel this?"
3. **Every angle.** Auto-orbit shows the movement in 3D, drag gives control, and presets jump to the best view for each cue. The key joint never hides behind the body.
4. **Personal.** Male or female body, plus the equipment the user actually has. Next: body type, left-handed mirroring, loaded weight.
5. **Scalable.** One rig, one muscle map, one equipment library. A new exercise is a short data file.
6. **Light and fast.** Under 3 MB, about 60 fps on a mid-range phone, works offline once cached.
7. **Calm and on-brand.** Mattr Night palette, a tasteful neutral body in training kit, nothing gym-bro.
8. **Accessible.**
   - Respects reduced-motion settings: no auto-orbit.
   - Every visual cue is also written in text.
   - Controls are 44 px or larger.
   - Colours meet contrast standards.

## Acceptance tests (Romanian deadlift)

- **Movement** (checked on side-view frames):
  - Knees stay at about 15–20° flexion.
  - Hips travel back.
  - The spine stays neutral.
  - The bar stays within 3 cm of a vertical line over mid-foot and stops just below the knee.
  - Shoulders stay over or ahead of the bar.
  - Feet don't slide.
- **Muscles:** hamstrings and glutes are primary. Erector spinae, adductor magnus, lats, traps and forearms are secondary or holding still.
- **Body switch:** switching male/female keeps the same movement and contact points, with hands on the bar and feet on the floor.
- **Equipment:** barbell and dumbbell variants both keep hands on the handles throughout.
- **Camera:** auto-orbit completes a full turn without clipping, and the four presets frame the whole body and the equipment.
- **Licences:** every asset is Apache-2.0, CC0 or our own.
