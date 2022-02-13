import { DrawingOnCanvas } from "./drawing2d";
import { Drawer3D } from "./drawing3d";

export function createDrawer() {
  return new Drawer3D();
}