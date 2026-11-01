// Romanian deadlift. Joint angles from the coach advisor's spec (NSCA technique; Lee 2018, Martín-Fuentes 2020 EMG).
// Sagittal angles in degrees. lean = trunk forward from vertical; hipFlex = lean + thigh angle; kneeFlex = shank + thigh; ankleDorsi = shank.
export default {
  id: 'rdl',
  name: 'Romanian deadlift',
  pattern: 'Hip hinge',
  equipment: ['barbell', 'dumbbells', 'kettlebell'],
  poses: {
    top:    { lean: 0,  hipFlex: 9,  kneeFlex: 15, ankleDorsi: 6, spineFlex: 0, neckFlex: 0 },
    bottom: { lean: 70, hipFlex: 87, kneeFlex: 18, ankleDorsi: 1, spineFlex: 2, neckFlex: -10 },
  },
  phases: [
    { name: 'descent', from: 'top', to: 'bottom', dur: 3.0, actFrom: 'top', actTo: 'bottom', cue: 'Push your hips back to the wall' },
    { name: 'bottom', from: 'bottom', to: 'bottom', dur: 0.5, hold: true, actFrom: 'bottom', actTo: 'bottom', cue: 'Feel the hamstrings stretch' },
    { name: 'ascent', from: 'bottom', to: 'top', dur: 1.5, actFrom: 'bottom', actTo: 'top', cue: 'Stand tall, squeeze your glutes' },
    { name: 'top', from: 'top', to: 'top', dur: 1.5, hold: true, actFrom: 'top', actTo: 'top', cue: 'Soft knees, shins stay still' },
  ],
  // relative activation 0..1 at key positions (advisor: EMG rank order, scaled)
  muscles: {
    hamstrings: { tier: 'primary',    act: { top: 0.2, bottom: 1.0 } },
    glutes:     { tier: 'primary',    act: { top: 0.3, bottom: 0.8 } },
    adductors:  { tier: 'secondary',  act: { top: 0.1, bottom: 0.7 } },
    erectors:   { tier: 'secondary',  act: { top: 0.3, bottom: 0.7 } },
    lats:       { tier: 'stabiliser', act: { top: 0.3, bottom: 0.5 } },
    traps:      { tier: 'stabiliser', act: { top: 0.4, bottom: 0.45 } },
    rhomboids:  { tier: 'stabiliser', act: { top: 0.25, bottom: 0.35 } },
    forearms:   { tier: 'stabiliser', act: { top: 0.6, bottom: 0.6 } },
    abs:        { tier: 'stabiliser', act: { top: 0.3, bottom: 0.4 } },
    obliques:   { tier: 'stabiliser', act: { top: 0.3, bottom: 0.4 } },
  },
  feel: 'Mostly the backs of your thighs, then your glutes as you stand. Your lower back works to stay still, not to lift.',
  cues: ['Push your hips back to the wall', 'Soft knees, shins stay still', 'Keep the bar on your legs', 'Stand tall, squeeze your glutes'],
  faults: ['Rounding the lower back', 'Squatting it: knees past 25°', 'Bar drifting off the legs', 'Leaning back at the top'],
  // camera dwell angles (degrees azimuth; 0 = front, 90 = side)
  camera: [{ az: 90, hold: 2.5 }, { az: 35, hold: 1.5 }, { az: 160, hold: 1.5 }],
};
