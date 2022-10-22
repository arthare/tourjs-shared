
export class StatsData {
  static counts:{[key:string]:number} = {};
  public static note(topic:string) {
    StatsData.counts[topic] = (StatsData.counts[topic] || 0) + 1;
  };
}