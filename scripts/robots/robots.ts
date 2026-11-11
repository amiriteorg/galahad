import type { Vec3 } from "../../apps/web/src/world/robots/kinematics.ts";

/*
 * The open-source robots the world draws, pinned to exact commits (all Apache-2.0),
 * and how each is turned into an asset: its triangle budget, which hidden parts are
 * left out (electronics sealed inside a shell, screws and connectors a few
 * millimetres long: nobody sees them, and they'd spend the budget), the frames kept
 * as named sites, and which joints stay movable.
 */

export interface DetachSpec {
  /** The link (with everything rigidly fixed to it) to hang from new joints. */
  link: string;
  /** The link it hangs from instead. */
  parent: string;
  /** Where the new joints turn: this link's origin at rest (their axes are the robot's own x, y, z). */
  pivot: string;
  joints: { name: string; axis: Vec3; lower: number; upper: number }[];
}

export interface RobotSpec {
  /** File stem of the asset. */
  name: string;
  title: string;
  repo: string;
  commit: string;
  /** The URDF, from the repository's root; meshes resolve against its folder. */
  urdf: string;
  /** Most triangles in the whole robot. */
  budget: number;
  /** Mesh files (basename, no extension) not drawn. */
  skip?: RegExp;
  /** Links kept as named sites (a fingertip, a sole, a head). */
  sites: string[];
  /** Joints that stay movable (default: every joint that isn't fixed). The rest are frozen at zero and merged. */
  movable?: (joint: string) => boolean;
  /** Re-hang a part on new joints (Reachy Mini's head, which in the URDF is carried by a closed chain). */
  detach?: DetachSpec;
  /** The colour for visuals the URDF gives none (sRGB 0..1). */
  defaultRgba: [number, number, number, number];
  /** The licence file, from the repository's root (default LICENSE). */
  license?: string;
  /** The copyright line the licence file carries, repeated in NOTICE.txt. */
  copyright?: string;
  /** The description is xacro: expanded first; $(find package) is the package folder, relative to the URDF's. */
  xacro?: Record<string, string>;
  /** Joints the description fixes that the real machine turns on (the rover's rockers): made revolute about `axis`. */
  free?: Record<string, { axis: Vec3; lower: number; upper: number }>;
}

const DEG = Math.PI / 180;

export const ROBOTS: RobotSpec[] = [
  {
    name: "open-duck-mini-v2",
    title: "Open Duck Mini v2",
    repo: "apirrone/Open_Duck_Mini",
    commit: "b23317a485b3cec7d8417f352478778b3475173c",
    urdf: "mini_bdx/robots/open_duck_mini_v2/robot.urdf",
    budget: 25_000,
    // Sealed inside the white body: the battery cells and their holder, the BMS, the
    // driver board, the IMU, the Raspberry Pi and the charger. The rest is all on show.
    skip: /^(cell|holder|bms|board|bno055|raspberrypizerow|usb_c_charger)$/,
    sites: ["trunk", "left_foot", "right_foot", "head"],
    defaultRgba: [0.92, 0.92, 0.92, 1],
  },
  {
    name: "so-101",
    title: "SO-101 arm",
    repo: "TheRobotStudio/SO-ARM100",
    commit: "a758567c3978dfeefe282ede0500085a48fe8f78",
    urdf: "Simulation/SO101/so101_new_calib.urdf",
    budget: 15_000,
    sites: ["gripper_frame_link"],
    defaultRgba: [1, 0.82, 0.12, 1],
  },
  {
    name: "reachy-mini",
    title: "Reachy Mini",
    repo: "pollen-robotics/reachy_mini",
    commit: "25756e7042e453bfd89ed46bebfee3dbc35f39be",
    urdf: "src/reachy_mini/descriptions/reachy_mini/urdf/robot.urdf",
    budget: 30_000,
    // Pins, screws, connectors and LED caps a few millimetres long; the camera board and speaker inside the head.
    skip: /^(phs_.*|b3b_eh.*|bts2_m2.*|dc15_a01_led_cap2_dummy|arducam|pp01102_arducam_carter|5w_speaker)$/,
    sites: ["head", "camera"],
    // The head rides a Stewart platform (six motors, six rods: a closed chain URDF can't
    // move by itself). The world keeps the body's yaw and the antennas, freezes the
    // platform at rest, and hangs the head on yaw, pitch and roll about its centre.
    movable: (j) => j === "yaw_body" || j === "left_antenna" || j === "right_antenna",
    detach: {
      link: "xl_330",
      parent: "body_down_3dprint",
      pivot: "head",
      joints: [
        { name: "head_yaw", axis: [0, 0, 1], lower: -60 * DEG, upper: 60 * DEG },
        { name: "head_pitch", axis: [0, 1, 0], lower: -30 * DEG, upper: 30 * DEG },
        { name: "head_roll", axis: [1, 0, 0], lower: -25 * DEG, upper: 25 * DEG },
      ],
    },
    defaultRgba: [0.9, 0.9, 0.9, 1],
  },
  {
    name: "open-source-rover",
    title: "Open Source Rover (NASA JPL)",
    repo: "nasa-jpl/osr-rover-code",
    commit: "7aaf18512c9e8a997931f0caae28b63c8c6e9a78",
    urdf: "ROS/osr_gazebo/urdf/osr.urdf.xacro",
    license: "LICENSE.txt",
    copyright: "Copyright 2018 California Institute of Technology. Government Sponsorship Acknowledged.",
    xacro: { osr_gazebo: ".." },
    budget: 9_000,
    sites: ["base_link"],
    // The description fixes each rocker to the body (its simulator drives the wheels only); on the real rover the
    // rockers pivot on the body through the differential, and the world moves them so.
    free: {
      rocker_bogie_joint_L_1: { axis: [0, 1, 0], lower: -40 * DEG, upper: 40 * DEG },
      rocker_bogie_joint_R_1: { axis: [0, 1, 0], lower: -40 * DEG, upper: 40 * DEG },
    },
    defaultRgba: [0.75, 0.75, 0.75, 1],
  },
];
