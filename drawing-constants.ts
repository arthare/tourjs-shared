import { Layer, ThemeConfig } from "./DecorationFactory";

export const defaultThemeConfig:ThemeConfig = {
  name: "Default Theme",
  rootURL: "/",
  decorationSpecs: [
    {
      name: "Clouds",
      minDimensions: {x:12,y:8},
      maxDimensions: {x:16,y:10},
      minAltitude: 2.5,
      maxAltitude: 12,
      imageUrl: ['assets/cloud1.png', 'assets/cloud2.png'],
      layer: Layer.NearSky,
      frequencyPerKm:50,
    }, {
      name: "Grasses",
      minDimensions: {x:1,y:1},
      maxDimensions: {x:1.2,y:1.2},
      minAltitude: -16,
      maxAltitude: -2,
      imageUrl: ['assets/grass2.png', 
                'assets/grass3.png', 
                'assets/grass4.png',
                'assets/grass5.png',
                'assets/grass6.png',
                'assets/grass7.png',
              ],
      layer: Layer.Underground,
      frequencyPerKm:1000,
    }, {
      name: "Stores",
      minDimensions: {x:4,y:4},
      maxDimensions: {x:4,y:4},
      minAltitude: 0,
      maxAltitude: 0,
      imageUrl: ['assets/store1.webp', 
                'assets/store2.webp', 
              ],
      layer: Layer.NearRoadside,
      frequencyPerKm:20,
    }, {
      name: "Trees",
      minDimensions: {x:4,y:4},
      maxDimensions: {x:8,y:8},
      minAltitude: 0,
      maxAltitude: 0,
      imageUrl: [
        'assets/tree1-by-art.webp', 
        'assets/tree2-by-art.webp', 
      ],
      layer: Layer.NearRoadside,
      frequencyPerKm:60,
    }
  ]
}
