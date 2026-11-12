import React, { useState } from 'react';
import {
  WeatherForecastResponse,
  WeatherForecastPoint,
  UnitSystem,
  WindSpeedUnit,
  WindDirDisplay,
} from '../types';
import {
  ChevronDown,
  ChevronUp,
  Droplets,
  Wind,
  Compass,
  Clock,
  Sparkles,
  Database,
} from 'lucide-react';
import { WindBarb, getTemperatureColor } from './WindBarb';

interface TimelineDrawerProps {
  weatherData: WeatherForecastResponse | null;
  isLoading: boolean;
  unitSystem: UnitSystem;
  speedUnit: WindSpeedUnit;
  dirDisplay: WindDirDisplay;
}

export const TimelineDrawer: React.FC<TimelineDrawerProps> = ({
  weatherData,
  isLoading,
  unitSystem,
  speedUnit,
  dirDisplay,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (!weatherData && !isLoading) {
    return null;
  }

  const formatPointTime = (timeStr: string) => {
    try {
      const date = new Date(timeStr);
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        hour: 'numeric',
        hour12: true,
      });
    } catch {
      return timeStr;
    }
  };

  const getTemperatureDisplay = (pt: WeatherForecastPoint) => {
    return unitSystem === 'imperial'
      ? `${Math.round(pt.temperature_f)}°F`
      : `${Math.round(pt.temperature_c)}°C`;
  };

  const getSpeedDisplay = (pt: WeatherForecastPoint) => {
    switch (speedUnit) {
      case 'kmh':
        return `${pt.wind_speed_kmh} km/h`;
      case 'mph':
        return `${pt.wind_speed_mph} mph`;
      case 'ms':
        return `${pt.wind_speed_ms} m/s`;
      case 'knots':
      default:
        return `${pt.wind_speed_knots} kt`;
    }
  };

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-40 bg-dark-900/95 backdrop-blur-md border-t border-dark-600 shadow-2xl transition-all duration-300 ease-in-out ${
        isCollapsed ? 'translate-y-[calc(100%-42px)]' : 'translate-y-0'
      }`}
    >
      {/* Drawer Header Bar */}
      <div className="h-10 px-4 flex items-center justify-between border-b border-dark-700/60 bg-dark-800/80">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-200 hover:text-sky-400 transition"
          >
            {isCollapsed ? (
              <ChevronUp className="w-4 h-4 text-sky-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-sky-400" />
            )}
            <span>48-Hour Forecast Timeline</span>
          </button>

          {weatherData && (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span className="text-gray-600">•</span>
              <span className="font-medium text-gray-100">
                {weatherData.location_name}
              </span>
              <span className="text-gray-600">•</span>
              <span className="hidden sm:inline font-mono text-[11px] text-gray-500">
                {weatherData.latitude.toFixed(2)}°, {weatherData.longitude.toFixed(2)}°
              </span>
            </div>
          )}
        </div>

        {weatherData && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="px-2 py-0.5 rounded bg-dark-700 text-gray-300 flex items-center gap-1">
              <Clock className="w-3 h-3 text-sky-400" />
              16 data points (3h intervals)
            </span>
            {weatherData.cached ? (
              <span
                title="Served from SQLite 30-min cache"
                className="px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/40 flex items-center gap-1"
              >
                <Database className="w-3 h-3" />
                Cached
              </span>
            ) : (
              <span
                title="Fresh forecast from Open-Meteo"
                className="px-2 py-0.5 rounded bg-sky-950/60 text-sky-400 border border-sky-800/40 flex items-center gap-1"
              >
                <Sparkles className="w-3 h-3" />
                Live
              </span>
            )}
          </div>
        )}
      </div>

      {/* 16-point Cards Content */}
      <div className="p-3">
        {isLoading ? (
          <div className="h-32 flex items-center justify-center text-xs text-sky-400 gap-2">
            <div className="w-4 h-4 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
            <span>Loading 48-hour forecast points...</span>
          </div>
        ) : weatherData ? (
          <div className="overflow-x-auto pb-1 flex gap-2.5 scroll-smooth">
            {weatherData.forecast.map((pt, index) => {
              const tempColor = getTemperatureColor(pt.temperature_f);
              const isCurrent = index === 0;

              return (
                <div
                  key={`${pt.time}-${index}`}
                  className={`min-w-[124px] max-w-[130px] p-2.5 rounded-xl border flex flex-col items-center justify-between gap-1.5 transition ${
                    isCurrent
                      ? 'bg-sky-950/30 border-sky-600/60 shadow-lg shadow-sky-950/50'
                      : 'bg-dark-800/90 border-dark-600 hover:border-dark-500'
                  }`}
                >
                  {/* Time label */}
                  <div className="text-center w-full">
                    <div className="text-[11px] font-semibold text-gray-200">
                      {isCurrent ? 'Now' : formatPointTime(pt.time)}
                    </div>
                    <div className="text-[9px] text-gray-500 font-mono">
                      +{index * 3}h
                    </div>
                  </div>

                  {/* Wind representation: Barbs (default), Cardinal, or Degrees */}
                  <div className="my-0.5 flex flex-col items-center justify-center min-h-[46px]">
                    {dirDisplay === 'barb' ? (
                      <WindBarb
                        speedKnots={pt.wind_speed_knots}
                        directionDeg={pt.wind_direction_deg}
                        tempF={pt.temperature_f}
                        size={46}
                        showLabel={false}
                      />
                    ) : dirDisplay === 'cardinal' ? (
                      <div className="flex flex-col items-center gap-0.5">
                        <Compass
                          className="w-5 h-5"
                          style={{
                            color: tempColor,
                            transform: `rotate(${pt.wind_direction_deg}deg)`,
                          }}
                        />
                        <span className="text-xs font-bold font-mono text-gray-200">
                          {pt.wind_direction_cardinal}
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-0.5">
                        <Compass
                          className="w-5 h-5"
                          style={{
                            color: tempColor,
                            transform: `rotate(${pt.wind_direction_deg}deg)`,
                          }}
                        />
                        <span className="text-[11px] font-mono text-gray-200">
                          {Math.round(pt.wind_direction_deg)}°
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Wind speed */}
                  <div className="text-[11px] font-medium text-gray-300 flex items-center gap-1">
                    <Wind className="w-3 h-3 text-sky-400" />
                    <span>{getSpeedDisplay(pt)}</span>
                  </div>

                  {/* Temperature with color coding */}
                  <div
                    className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{
                      color: tempColor,
                      backgroundColor: `${tempColor}15`,
                      border: `1px solid ${tempColor}30`,
                    }}
                  >
                    {getTemperatureDisplay(pt)}
                  </div>

                  {/* Humidity */}
                  <div className="text-[10px] text-gray-400 flex items-center gap-0.5">
                    <Droplets className="w-2.5 h-2.5 text-blue-400" />
                    <span>{Math.round(pt.humidity)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
};

