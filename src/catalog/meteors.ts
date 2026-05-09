export interface MeteorShower {
  id: string;
  name: string;
  peakMonth: number;
  peakDay: number;
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
  zhr: number;
  speed: number;      // km/s
  radiantRA: number;
  radiantDec: number;
  parentBody: string;
}

export const METEOR_SHOWERS: MeteorShower[] = [
  { id: "quadrantids", name: "Quadrantids", peakMonth: 1, peakDay: 3, startMonth: 12, startDay: 28, endMonth: 1, endDay: 12, zhr: 110, speed: 41, radiantRA: 15.33, radiantDec: 49.5, parentBody: "2003 EH1" },
  { id: "lyrids", name: "Lyrids", peakMonth: 4, peakDay: 22, startMonth: 4, startDay: 16, endMonth: 4, endDay: 25, zhr: 18, speed: 49, radiantRA: 18.07, radiantDec: 33.3, parentBody: "C/1861 G1 (Thatcher)" },
  { id: "eta-aquariids", name: "Eta Aquariids", peakMonth: 5, peakDay: 6, startMonth: 4, startDay: 19, endMonth: 5, endDay: 28, zhr: 50, speed: 66, radiantRA: 22.33, radiantDec: -1.0, parentBody: "1P/Halley" },
  { id: "delta-aquariids", name: "Delta Aquariids", peakMonth: 7, peakDay: 30, startMonth: 7, startDay: 12, endMonth: 8, endDay: 23, zhr: 25, speed: 41, radiantRA: 22.67, radiantDec: -16.5, parentBody: "96P/Machholz" },
  { id: "perseids", name: "Perseids", peakMonth: 8, peakDay: 12, startMonth: 7, startDay: 17, endMonth: 8, endDay: 24, zhr: 100, speed: 59, radiantRA: 3.13, radiantDec: 58.0, parentBody: "109P/Swift-Tuttle" },
  { id: "orionids", name: "Orionids", peakMonth: 10, peakDay: 21, startMonth: 10, startDay: 2, endMonth: 11, endDay: 7, zhr: 20, speed: 66, radiantRA: 6.33, radiantDec: 15.5, parentBody: "1P/Halley" },
  { id: "leonids", name: "Leonids", peakMonth: 11, peakDay: 17, startMonth: 11, startDay: 6, endMonth: 11, endDay: 30, zhr: 15, speed: 71, radiantRA: 10.13, radiantDec: 22.0, parentBody: "55P/Tempel-Tuttle" },
  { id: "geminids", name: "Geminids", peakMonth: 12, peakDay: 14, startMonth: 12, startDay: 4, endMonth: 12, endDay: 20, zhr: 150, speed: 35, radiantRA: 7.47, radiantDec: 32.0, parentBody: "3200 Phaethon" },
  { id: "ursids", name: "Ursids", peakMonth: 12, peakDay: 22, startMonth: 12, startDay: 17, endMonth: 12, endDay: 26, zhr: 10, speed: 33, radiantRA: 14.47, radiantDec: 75.0, parentBody: "8P/Tuttle" }
];
