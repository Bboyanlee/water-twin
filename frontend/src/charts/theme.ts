import * as echarts from 'echarts';

export const CHART_COLORS = ['#00E5FF', '#2BD99F', '#FF9F1C', '#B57BFF', '#19B6FF', '#FFD84D', '#FF4D4F'];

const axisCommon = {
  axisLine: { lineStyle: { color: 'rgba(0,229,255,0.25)' } },
  axisTick: { lineStyle: { color: 'rgba(0,229,255,0.25)' } },
  axisLabel: { color: '#7fa6c8', fontSize: 11 },
  splitLine: { lineStyle: { color: 'rgba(0,229,255,0.07)', type: 'dashed' } },
  nameTextStyle: { color: '#7fa6c8', fontSize: 11 },
};

echarts.registerTheme('twin', {
  color: CHART_COLORS,
  backgroundColor: 'transparent',
  textStyle: { fontFamily: "'Noto Sans TC', sans-serif", color: '#9fc3e0' },
  title: { textStyle: { color: '#e6f7ff' } },
  legend: { textStyle: { color: '#9fc3e0', fontSize: 11 }, itemHeight: 8, itemWidth: 14 },
  tooltip: {
    backgroundColor: 'rgba(6,20,43,0.92)',
    borderColor: 'rgba(0,229,255,0.5)',
    textStyle: { color: '#e6f7ff', fontSize: 12 },
    axisPointer: { lineStyle: { color: 'rgba(0,229,255,0.6)' }, crossStyle: { color: 'rgba(0,229,255,0.6)' } },
  },
  categoryAxis: axisCommon,
  valueAxis: axisCommon,
  timeAxis: axisCommon,
  line: { symbol: 'none', smooth: true, lineStyle: { width: 2 } },
  gauge: {
    axisLine: { lineStyle: { color: [[1, 'rgba(0,229,255,0.2)']] } },
  },
});

export { echarts };
