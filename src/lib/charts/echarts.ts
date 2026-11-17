// Модульный ECharts: в бандл попадает только нужное; 3D (echarts-gl) грузится лениво.
import * as echarts from 'echarts/core';
import {
  BarChart, LineChart, PieChart, TreemapChart, SunburstChart, ScatterChart, EffectScatterChart,
  HeatmapChart, RadarChart, FunnelChart, GaugeChart, SankeyChart, GraphChart, CustomChart,
} from 'echarts/charts';
import {
  GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, DataZoomComponent,
  TitleComponent, MarkLineComponent, MarkPointComponent, GraphicComponent, PolarComponent, RadarComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { LabelLayout, UniversalTransition } from 'echarts/features';

echarts.use([
  BarChart, LineChart, PieChart, TreemapChart, SunburstChart, ScatterChart, EffectScatterChart,
  HeatmapChart, RadarChart, FunnelChart, GaugeChart, SankeyChart, GraphChart, CustomChart,
  GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, DataZoomComponent,
  TitleComponent, MarkLineComponent, MarkPointComponent, GraphicComponent, PolarComponent, RadarComponent,
  CanvasRenderer, LabelLayout, UniversalTransition,
]);

let gl: Promise<unknown> | null = null;
export const ensureGL = () => (gl ??= import('echarts-gl'));

export { echarts };
