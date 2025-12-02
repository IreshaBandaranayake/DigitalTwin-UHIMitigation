import React, { useEffect, useRef, useState } from "react";
import "./App.css";

// Import Cesium core classes
import { defined, Viewer, Ion, createWorldTerrainAsync, Cartesian3, Math as CesiumMath,IonImageryProvider, OpenStreetMapImageryProvider, createOsmBuildingsAsync, ScreenSpaceEventType,ScreenSpaceEventHandler, GeoJsonDataSource, Color, VerticalOrigin, Cartographic, Cartesian2 } from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";


function App() {
  const viewerRef = useRef(null);
  const [activeTool, setActiveTool] = useState(null); // track current intervention mode
  const activeToolRef = useRef(null); // ✅ new ref to always hold latest tool
  const [infoMessage, setInfoMessage] = useState("");

  // ✅ Keep ref synced with state
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    // Set Cesium Ion Token
    Ion.defaultAccessToken = " ";

    // Tell Cesium where to load static assets
    window.CESIUM_BASE_URL = "/Cesium/";

    async function initCesium() {
      // Use async terrain loader
      const terrainProvider = await createWorldTerrainAsync();
      const viewer = new Viewer("cesiumContainer", {
        terrainProvider,
        baseLayerPicker: false,        
      });

      // Enable depth test for pickPosition
      //viewer.scene.globe.depthTestAgainstTerrain = true;
      // Disable depth test for better pickPosition accuracy
      viewer.scene.globe.depthTestAgainstTerrain = false;

      // Try Ion imagery first, fallback to OSM
      try {
        const ionImagery = await IonImageryProvider.fromAssetId(3);
        viewer.imageryLayers.addImageryProvider(ionImagery);
      } catch (err) {
        console.error("Ion imagery failed, falling back to OSM:", err);
        viewer.imageryLayers.addImageryProvider(
          new OpenStreetMapImageryProvider({
            url: "https://a.tile.openstreetmap.org/",
          }) 
        );
      }

      // Add 3D OSM buildings
      createOsmBuildingsAsync().then((osmBuildings) => {
        viewer.scene.primitives.add(osmBuildings);
      }); 
      //createOsmBuildingsAsync().then((b) => viewer.scene.primitives.add(b));

      // Fly directly to Lahti city center
      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(25.6615, 60.9827, 250),  // 🟢 Lower altitude (~350m)
        orientation: {
          heading: CesiumMath.toRadians(0),
          pitch: CesiumMath.toRadians(-35),
          roll: 0,
        },
        //duration: 2.5,  // smooth transition
      });
/*
      // Just test marker
      viewer.entities.add({
        position: Cartesian3.fromDegrees(25.6615, 60.9827, 200),
        point: { pixelSize: 10, color: Color.RED },
      }); */

/*
     // Force a visible red dot ABOVE terrain for my testing purpose
      viewer.entities.add({
        position: Cartesian3.fromDegrees(25.6615, 60.9827, 200), // 200 meters up
        point: {
          pixelSize: 20,
          color: Color.RED,
          heightReference: HeightReference.NONE, // ignore terrain clamping
        },
      }); 
*/

      // Load sample UHI test dataset
      try {
        const dataSource = await GeoJsonDataSource.load("/data/uhi_test_data.geojson", {
          stroke: Color.BLACK,
          fill: Color.RED.withAlpha(0.4),
          strokeWidth: 2,
          clampToGround: true,
        });
        viewer.dataSources.add(dataSource);
        console.log("UHI test dataset loaded");
      } catch {
        console.error("Failed to load UHI dataset");
      }

      

      // Click handler for interventions
      const handler = new ScreenSpaceEventHandler(viewer.canvas);
      handler.setInputAction(async (click) => {
        const currentTool = activeToolRef.current;
        console.log("🖱️ Map clicked! Current tool:", currentTool, click.position);

        if (!currentTool) {
          console.warn("⚠️ No active tool selected");
          return;
        }

        let pickedPosition = viewer.scene.pickPosition(click.position);
        if (!defined(pickedPosition)) {
          const ray = viewer.camera.getPickRay(click.position);
          pickedPosition = viewer.scene.globe.pick(ray, viewer.scene);
        }

        if (!defined(pickedPosition)) {
          console.warn("⚠️ Could not determine position.");
          return;
        }

        const cartographic = Cartographic.fromCartesian(pickedPosition);
        const lon = CesiumMath.toDegrees(cartographic.longitude);
        const lat = CesiumMath.toDegrees(cartographic.latitude);
        console.log(`📍 Clicked coords: (${lon}, ${lat})`);

        try {
          const response = await fetch("http://127.0.0.1:8000/api/predict", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: currentTool, lon, lat }),
          });

          const data = await response.json();
          console.log("✅ Backend response:", data);

          
          // 🌡️ Interpret UHI effect
          const uhiEffect =
            data.LST_change < 0
              ? "🌿 UHI reduced"
              : data.LST_change > 0
              ? "🔥 UHI increased"
              : "⚖️ No significant change";

          // 💬 Show popup message
          const lstChange = data.LST_change ?? data.delta_LST ?? 0;
          const predicted = data.predicted_LST ?? 0;

          setInfoMessage(
            `${uhiEffect} | ΔLST: ${lstChange.toFixed(2)}°C | New LST: ${predicted.toFixed(2)}°C`
          );

          // Automatically clear after 5 seconds
          //setTimeout(() => setInfoMessage(""), 5000);

          // 🖼️ Choose correct icon
          let iconPath = "/icons/buildingarea.png";
          if (currentTool === "tree") iconPath = "/icons/greenarea.png";
          if (currentTool === "roof") iconPath = "/icons/greenroof.png";
          if (currentTool === "water") iconPath = "/icons/waterbody.png";
          //if (currentTool === "biolding") iconPath = "/icons/water.png";

          // 🗺️ Add entity
          viewer.entities.add({
            position: pickedPosition,
            billboard: {
              image: iconPath,
              verticalOrigin: VerticalOrigin.BOTTOM,
              scale: 0.15,
              width: 300,   // optional — fix size regardless of zoom
              height: 300,
            },
            label: {
              text: `ΔLST: ${data.delta_LST?.toFixed(2) ?? "N/A"}°C`,
              font: "16px sans-serif",
              fillColor: Color.BLACK, //(data.delta_LST ?? 0) < 0 ? Color.GREEN : Color.RED,
              outlineColor: Color.BLACK,
              outlineWidth: 2,
              style: 2,
              verticalOrigin: VerticalOrigin.TOP,
              pixelOffset: new Cartesian2(0, -50),
            },
          });

          viewer.scene.requestRender();
        } catch (err) {
          console.error("❌ Backend request failed:", err);
          alert("Failed to contact backend server.");
        }
      }, ScreenSpaceEventType.LEFT_CLICK);

      viewer.scene.requestRenderMode = true;
      viewerRef.current = viewer;
    }

    initCesium();
  }, []);

  /*
  // 🎥 Camera bookmarks for key areas in Lahti
  function flyToLocation(location) {
  const viewer = viewerRef.current;
  if (!viewer) {
    console.warn("⚠️ Viewer not ready yet. Try again in a moment.");
    return;
  }

  const views = {
    marketSquare: {
      lon: 25.6615,
      lat: 60.9823,
      height: 250,
      heading: 15,
      pitch: -35,
      label: "Lahti Market Square",
    },
    sportsCentre: {
      lon: 25.6629,
      lat: 60.9774,
      height: 300,
      heading: 10,
      pitch: -30,
      label: "Lahti Sports Centre",
    },
    radiomaki: {
      lon: 25.6559,
      lat: 60.9794,
      height: 280,
      heading: 25,
      pitch: -35,
      label: "Radiomäki Hill & Towers",
    },
  };

  const target = views[location];
  if (!target) {
    console.warn(`⚠️ Unknown camera view: ${location}`);
    return;
  }

  console.log(`📍 Flying to ${target.label}`);

  // 🟢 Fly smoothly using Cesium’s built-in easing
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(target.lon, target.lat, target.height),
    orientation: {
      heading: CesiumMath.toRadians(target.heading),
      pitch: CesiumMath.toRadians(target.pitch),
      roll: 0,
    },
    duration: 3, // seconds
  });
}

*/

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      {/* 🧭 Floating message */}
      {infoMessage && (
        <div
          style={{
            position: "absolute",
            top: "10px",
            right: "10px",
            zIndex: 1000,
            background: "rgba(0,0,0,0.7)",
            color: "white",
            padding: "10px 16px",
            borderRadius: "8px",
            fontSize: "14px",
            maxWidth: "320px",
          }}
        >
          {infoMessage}
        </div>
      )}

      {/* Buttons */}
      {/* 🌳 Action & Camera Buttons */}
      <div
        style={{
          position: "absolute",
          top: "10px",
          left: "10px",
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        {/* Intervention Tools */}
        <button onClick={() => setActiveTool("tree")}>🌳 Add Tree Area</button>
        <button onClick={() => setActiveTool("roof")}>🏠 Add Green Roof</button>
        <button onClick={() => setActiveTool("water")}>💧 Add Water Body</button>
        <button onClick={() => setActiveTool("building")}>🏢 Add Building Block</button>

        

        {/* Collapsible Camera Section */}
        {/* <details style={{ marginTop: "10px" }}>
          <summary style={{ cursor: "pointer", fontWeight: "bold" }}>
            📸 Camera Views
          </summary>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              marginTop: "6px",
            }}
          >
            <button onClick={() => flyToLocation("marketSquare")}>
              📍 Market Square
            </button>
            <button onClick={() => flyToLocation("sportsCentre")}>
              🏟️ Sports Centre
            </button>
            <button onClick={() => flyToLocation("radiomaki")}>
              📡 Radiomäki Hill
            </button>
          </div>
        </details>    */}
      </div>

      <div id="cesiumContainer" style={{ width: "100%", height: "100%" }} />
    </div>
  );
}


export default App;
