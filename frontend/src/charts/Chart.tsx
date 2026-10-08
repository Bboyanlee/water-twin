import { forwardRef } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import './theme';

interface Props {
  option: EChartsOption;
  style?: React.CSSProperties;
  notMerge?: boolean;
}

/** 套用深色 twin 主題的 ECharts 包裝 */
const Chart = forwardRef<ReactECharts, Props>(function Chart({ option, style, notMerge = false }, ref) {
  return (
    <ReactECharts
      ref={ref}
      option={option}
      theme="twin"
      notMerge={notMerge}
      lazyUpdate
      style={{ width: '100%', height: '100%', ...style }}
      opts={{ renderer: 'canvas' }}
    />
  );
});

export default Chart;

export const fmtTime = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
