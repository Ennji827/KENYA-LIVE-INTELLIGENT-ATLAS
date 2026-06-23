import json
import os
import shutil
import tempfile
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from aeis_dashboard.models import AEISUser, ProcessingJob, SystemSetting
from aeis_dashboard.services.auth import seed_default_accounts
from aeis_dashboard.services import domain, jobs


TEST_MEDIA_ROOT = tempfile.mkdtemp(prefix="aeis-test-media-")


@override_settings(
    MEDIA_ROOT=TEST_MEDIA_ROOT,
    PASSWORD_HASHERS=[
        "django.contrib.auth.hashers.MD5PasswordHasher",
        "aeis_dashboard.hashers.LegacyAEISPasswordHasher",
    ]
)
class AEISApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_default_accounts()

    def test_health_and_county_catalog(self):
        health = self.client.get("/health")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json()["runtime"], "django")
        self.assertEqual(health.json()["status"], "healthy")
        self.assertTrue(all(health.json()["checks"].values()))
        self.assertTrue(health["X-Request-ID"])
        self.assertIn("app;dur=", health["Server-Timing"])

        response = self.client.get("/api/boundary/counties")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["counties"]), 47)

        summary = self.client.get("/api/dashboard/summary")
        self.assertEqual(summary.status_code, 200)
        self.assertEqual(summary.json()["summary"]["countiesTracked"], 47)
        self.assertGreaterEqual(summary.json()["summary"]["connectedSources"], 4)
        self.assertIn("dataGaps", summary.json()["summary"])

    def test_demo_county_login_session_and_logout(self):
        SystemSetting.objects.update_or_create(key="public_access_locked", defaults={"value": "0"})
        response = self.client.post(
            "/api/auth/county-login",
            {
                "county_code": "001",
                "email": "mombasa@county.aeis-k.local",
                "password": "county123",
                "demo_remote_access": True,
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        token = response.json()["token"]

        validation = self.client.post(
            "/api/auth/validate-session",
            {"token": token},
            content_type="application/json",
        )
        self.assertEqual(validation.status_code, 200)
        self.assertEqual(validation.json()["county_code"], "001")

        logout = self.client.post(
            "/api/auth/logout",
            {"token": token},
            content_type="application/json",
        )
        self.assertEqual(logout.status_code, 200)

    def test_drawn_polygon_uses_geodesic_area_without_synthetic_metrics(self):
        response = self.client.post(
            "/api/analysis/area",
            {
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[36.0, -1.0], [36.01, -1.0], [36.01, -0.99], [36.0, -0.99], [36.0, -1.0]]],
                }
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertGreater(payload["area_ha"], 100)
        self.assertLess(payload["area_ha"], 140)
        self.assertIsNone(payload["risk"]["score"])
        self.assertEqual(payload["data_mode"], "source_required")

    def _ministry_token(self):
        response = self.client.post(
            "/api/auth/national-login",
            {"email": "ministry.command@aeis-k.local", "password": "ministry123"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        return response.json()["token"]

    def test_ministry_can_upload_and_catalogue_geojson(self):
        token = self._ministry_token()
        geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"name": "Test farm"},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[36.0, -1.0], [36.01, -1.0], [36.01, -0.99], [36.0, -0.99], [36.0, -1.0]]],
                    },
                }
            ],
        }
        upload = SimpleUploadedFile(
            "test-farms.geojson",
            json.dumps(geojson).encode("utf-8"),
            content_type="application/geo+json",
        )
        response = self.client.post(
            "/api/data/assets/upload",
            {"name": "Test farms", "scope_level": "county", "scope_name": "Mombasa", "file": upload},
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(response.status_code, 201)
        asset = response.json()["asset"]
        self.assertEqual(asset["feature_count"], 1)
        self.assertEqual(asset["geometry_types"], ["Polygon"])
        self.assertEqual(len(asset["bbox"]), 4)
        self.assertTrue(asset["quality"]["coordinate_reference_system"].startswith("EPSG:4326"))
        self.assertIn(asset["quality"]["processing_status"], {"ready", "warning"})

        listing = self.client.get("/api/data/assets", HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(len(listing.json()["assets"]), 1)

        quality = self.client.get(
            "/api/data/quality",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(quality.status_code, 200)
        self.assertEqual(quality.json()["results"][0]["name"], "Test farms")

    def test_audit_log_requires_auditor_or_ministry_session(self):
        denied = self.client.get("/api/auth/audit-log")
        self.assertEqual(denied.status_code, 403)

        login = self.client.post(
            "/api/auth/national-login",
            {"email": "national.auditor@aeis-k.local", "password": "auditor123"},
            content_type="application/json",
        )
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.json()["role"], "auditor")
        response = self.client.get(
            "/api/auth/audit-log",
            HTTP_AUTHORIZATION=f"Bearer {login.json()['token']}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("events", response.json())

    def test_ministry_can_create_scoped_field_officer_account(self):
        token = self._ministry_token()
        response = self.client.post(
            "/api/users",
            {
                "username": "mombasa_field_test",
                "email": "field.test@mombasa.example",
                "password": "fieldpass123",
                "role": "field_officer",
                "county_name": "Mombasa",
                "first_name": "Field",
                "last_name": "Officer",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["user"]["county_code"], "001")
        self.assertEqual(response.json()["user"]["role"], "field_officer")
        self.assertTrue(
            AEISUser.objects.filter(email="field.test@mombasa.example", role="field_officer").exists()
        )

        SystemSetting.objects.update_or_create(key="public_access_locked", defaults={"value": "0"})
        login = self.client.post(
            "/api/auth/county-login",
            {
                "county_code": "001",
                "email": "field.test@mombasa.example",
                "password": "fieldpass123",
                "demo_remote_access": True,
            },
            content_type="application/json",
        )
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.json()["role"], "field_officer")

        submitted = self.client.post(
            "/api/field-reports",
            {
                "title": "Coastal maize inspection",
                "county_name": "Mombasa",
                "ward_name": "Test ward",
                "crop_type": "Maize",
                "observation_date": "2026-06-22",
                "observations": "Leaf condition requires county verification.",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {login.json()['token']}",
        )
        self.assertEqual(submitted.status_code, 201)

        verified = self.client.post(
            f"/api/field-reports/{submitted.json()['id']}/verify",
            {"status": "verified"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(verified.status_code, 200)
        self.assertEqual(verified.json()["verification_status"], "verified")

    @patch.dict(os.environ, {"OPENAI_API_KEY": ""}, clear=False)
    @patch("aeis_dashboard.services.intelligence._data_context")
    def test_intelligence_query_uses_grounded_local_fallback(self, mocked_context):
        mocked_context.return_value = (
            {
                "weather": {
                    "mode": "national_live_forecast",
                    "counties": [
                        {"county": "Mombasa", "daily": [{"precipitation_sum": 1.0}]},
                        {"county": "Kisumu", "daily": [{"precipitation_sum": 18.0}]},
                    ],
                },
                "field_reports": {"count": 0, "verified": 0},
                "alerts": [],
                "raster_indices": {"configured_layers": []},
            },
            [{"name": "Open-Meteo forecast API", "category": "weather", "status": "live"}],
            ["Provider-backed NDVI values"],
        )
        token = self._ministry_token()
        response = self.client.post(
            "/api/intelligence/query",
            {
                "question": "Which counties need dry-condition verification?",
                "scope_level": "national",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertEqual(payload["provider"], "local_rule_based")
        self.assertEqual(payload["data_sources"][0]["name"], "Open-Meteo forecast API")
        self.assertIn("Provider-backed NDVI values", payload["missing_data"])
        self.assertIn(payload["confidence"], {"low", "medium", "high"})

    @patch.dict(os.environ, {"OPENAI_API_KEY": ""}, clear=False)
    def test_county_intelligence_cannot_escape_assigned_scope(self):
        SystemSetting.objects.update_or_create(key="public_access_locked", defaults={"value": "0"})
        login = self.client.post(
            "/api/auth/county-login",
            {
                "county_code": "001",
                "email": "mombasa@county.aeis-k.local",
                "password": "county123",
                "demo_remote_access": True,
            },
            content_type="application/json",
        )
        response = self.client.post(
            "/api/intelligence/query",
            {
                "question": "Analyze another county",
                "scope_level": "county",
                "scope_name": "Nyandarua",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {login.json()['token']}",
        )
        self.assertEqual(response.status_code, 403)

    @patch("aeis_dashboard.services.reports.intelligence.generate_intelligence")
    def test_report_workflow_and_exports_are_audited(self, mocked_intelligence):
        mocked_intelligence.return_value = {
            "scope": {"level": "national", "name": "Kenya", "code": "000"},
            "executive_summary": "Connected evidence indicates routine national monitoring.",
            "key_observations": ["Weather evidence is available."],
            "risk_areas": ["No confirmed anomaly."],
            "affected_areas": [],
            "evidence": [{"source": "Open-Meteo", "observation": "Forecast available."}],
            "recommended_actions": ["Continue verification."],
            "confidence": "medium",
            "data_sources": [{"name": "Open-Meteo", "category": "weather", "status": "live"}],
            "missing_data": ["NDVI anomaly series"],
            "explainability": "Only connected evidence was used.",
        }
        token = self._ministry_token()
        created = self.client.post(
            "/api/reports",
            {"title": "National Operations Brief", "scope_level": "national"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(created.status_code, 201)
        report = created.json()["report"]
        self.assertEqual(report["status"], "draft")

        for target in ("reviewed", "approved", "published"):
            transitioned = self.client.post(
                f"/api/reports/{report['id']}/transition",
                {"status": target},
                content_type="application/json",
                HTTP_AUTHORIZATION=f"Bearer {token}",
            )
            self.assertEqual(transitioned.status_code, 200)
            report = transitioned.json()["report"]
            self.assertEqual(report["status"], target)

        exported = self.client.get(
            f"/api/reports/{report['id']}/export/pdf",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(exported.status_code, 200)
        self.assertEqual(exported["Content-Type"], "application/pdf")
        self.assertTrue(exported.content.startswith(b"%PDF"))
        self.assertGreaterEqual(len(report["audit_events"]), 4)

        dashboard_reports = self.client.get(
            "/api/dashboard/reports",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(dashboard_reports.status_code, 200)
        self.assertEqual(dashboard_reports.json()["reports"][0]["id"], report["id"])

        denied = self.client.get("/api/dashboard/reports")
        self.assertEqual(denied.status_code, 403)

    @patch("aeis_dashboard.services.reports.intelligence.generate_intelligence")
    def test_async_report_job_is_durable_and_returns_report_id(self, mocked_intelligence):
        mocked_intelligence.return_value = {
            "scope": {"level": "national", "name": "Kenya", "code": "000"},
            "executive_summary": "Durable worker report.",
            "key_observations": ["Queue processing is active."],
            "risk_areas": ["No confirmed anomaly."],
            "affected_areas": [],
            "evidence": [{"source": "AEIS-K", "observation": "Background job test."}],
            "recommended_actions": ["Continue monitoring."],
            "confidence": "medium",
            "data_sources": [{"name": "AEIS-K", "category": "system", "status": "available"}],
            "missing_data": [],
            "explainability": "Generated by the durable processing worker.",
        }
        token = self._ministry_token()
        queued = self.client.post(
            "/api/reports",
            {"title": "Queued Brief", "scope_level": "national", "async": True},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(queued.status_code, 202)
        job_id = queued.json()["job"]["id"]
        self.assertEqual(queued.json()["job"]["status"], "queued")

        processed = jobs.process_next()
        self.assertEqual(str(processed.pk), job_id)
        self.assertEqual(processed.status, ProcessingJob.Status.SUCCEEDED)
        self.assertTrue(processed.result["report_id"])

        status = self.client.get(
            f"/api/jobs/{job_id}",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.json()["job"]["status"], "succeeded")
        self.assertEqual(status.json()["job"]["progress"], 100)

    def test_queued_job_can_be_cancelled(self):
        token = self._ministry_token()
        queued = self.client.post(
            "/api/intelligence/query",
            {
                "question": "Queue this analysis.",
                "scope_level": "national",
                "async": True,
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(queued.status_code, 202)
        job_id = queued.json()["job"]["id"]
        cancelled = self.client.post(
            f"/api/jobs/{job_id}",
            {},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(cancelled.status_code, 200)
        self.assertEqual(cancelled.json()["job"]["status"], "cancelled")

    @patch("aeis_dashboard.services.data_sources.urlopen")
    def test_nasa_power_history_normalizes_monthly_records(self, mocked_urlopen):
        token = self._ministry_token()
        payload = {
            "header": {"fill_value": -999.0},
            "properties": {
                "parameter": {
                    "PRECTOTCORR": {"201601": 2.5, "201613": 2.0, "202512": 1.2},
                    "T2M": {"201601": 24.1, "201613": 24.0, "202512": 25.0},
                    "T2M_MAX": {"201601": 29.0, "202512": 30.0},
                    "T2M_MIN": {"201601": 20.0, "202512": 21.0},
                    "RH2M": {"201601": 75.0, "202512": 73.0},
                    "WS2M": {"201601": 3.0, "202512": 3.4},
                }
            },
            "parameters": {
                "PRECTOTCORR": {"units": "mm/day", "longname": "Precipitation Corrected"},
                "T2M": {"units": "C", "longname": "Temperature at 2 Meters"},
            },
        }
        mocked_urlopen.return_value.__enter__.return_value.read.return_value = json.dumps(payload).encode("utf-8")
        response = self.client.get(
            "/api/data/history/nasa-power?county=Mombasa&temporal=monthly&start=2016-01-01&end=2025-12-31",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["record_count"], 2)
        self.assertEqual(data["latest_available"], "2025-12-01")

    @patch("aeis_dashboard.services.data_sources.urlopen")
    def test_sentinel_catalogue_search_returns_source_metadata(self, mocked_urlopen):
        token = self._ministry_token()
        payload = {
            "features": [
                {
                    "id": "S2_TEST",
                    "collection": "sentinel-2-l2a",
                    "bbox": [39.0, -4.0, 40.0, -3.0],
                    "properties": {
                        "datetime": "2026-06-18T07:30:31Z",
                        "eo:cloud_cover": 8.2,
                        "platform": "sentinel-2a",
                        "instruments": ["msi"],
                    },
                    "assets": {"thumbnail": {"href": "https://example.test/thumb.jpg"}},
                    "links": [{"rel": "self", "href": "https://example.test/item.json"}],
                }
            ]
        }
        mocked_urlopen.return_value.__enter__.return_value.read.return_value = json.dumps(payload).encode("utf-8")
        response = self.client.get(
            "/api/data/imagery/sentinel-2?county=Mombasa&start=2016-06-20&end=2026-06-18",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["item_count"], 1)
        self.assertEqual(data["items"][0]["id"], "S2_TEST")

    @patch("aeis_dashboard.services.data_sources.urlopen")
    def test_latest_landsat_scene_is_returned_for_map_overlay(self, mocked_urlopen):
        usgs_payload = {
            "features": [
                {
                    "id": "LC09_TEST_SR",
                    "collection": "landsat-c2l2-sr",
                    "bbox": [38.8, -4.0, 40.8, -1.8],
                    "properties": {
                        "datetime": "2026-06-06T07:30:27Z",
                        "eo:cloud_cover": 12.4,
                        "platform": "LANDSAT_9",
                    },
                    "assets": {
                        "thumbnail": {"href": "https://example.test/thumb.jpeg"},
                        "reduced_resolution_browse": {"href": "https://example.test/browse.jpeg"},
                        "red": {"href": "https://example.test/red.tif"},
                        "nir08": {"href": "https://example.test/nir.tif"},
                    },
                    "links": [{"rel": "self", "href": "https://example.test/item.json"}],
                }
            ]
        }
        capabilities = """
        <Layer>
          <Name>ls9_sr</Name>
          <Dimension name="time" units="ISO8601" default="2026-05-02">2026-04-03,2026-05-02</Dimension>
        </Layer>
        """
        deafrica_payload = {
            "features": [
                {
                    "id": "DEAFRICA_LS9_TEST",
                    "bbox": [38.8, -4.0, 40.8, -1.8],
                    "properties": {
                        "datetime": "2026-04-03T07:31:30Z",
                        "eo:cloud_cover": 10.15,
                    },
                }
            ]
        }

        def response_with(content):
            context = MagicMock()
            context.__enter__.return_value.read.return_value = content
            return context

        mocked_urlopen.side_effect = [
            response_with(json.dumps(usgs_payload).encode("utf-8")),
            response_with(capabilities.encode("utf-8")),
            response_with(json.dumps(deafrica_payload).encode("utf-8")),
        ]
        response = self.client.get("/api/data/imagery/landsat/latest?county=Mombasa")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "available")
        self.assertEqual(data["scene"]["platform"], "LANDSAT_9")
        self.assertTrue(data["scene"]["download_requires_usgs_login"])
        self.assertEqual(data["map_overlay"]["date"], "2026-04-03")
        self.assertEqual(data["map_overlay"]["layers"], "ls9_sr")
        self.assertIn("request=GetMap", data["map_overlay"]["preview_url"])

    @patch("aeis_dashboard.services.data_sources.urlopen")
    def test_landsat_map_proxy_returns_validated_png(self, mocked_urlopen):
        upstream = MagicMock()
        upstream.__enter__.return_value.read.return_value = b"\x89PNG\r\n\x1a\nAEIS"
        upstream.__enter__.return_value.headers.get_content_type.return_value = "image/png"
        mocked_urlopen.return_value = upstream

        response = self.client.get(
            "/api/data/imagery/landsat/map",
            {
                "bbox": "4390000,-480000,4420000,-450000",
                "width": "256",
                "height": "256",
                "time": "2026-04-03",
                "crs": "EPSG:3857",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/png")
        self.assertTrue(response.content.startswith(b"\x89PNG"))

        invalid = self.client.get(
            "/api/data/imagery/landsat/map",
            {"bbox": "not-a-bbox", "time": "2026-04-03"},
        )
        self.assertEqual(invalid.status_code, 400)

    def test_weather_uses_open_meteo_best_match_and_ten_days(self):
        url = domain.open_meteo_url(-4.04, 39.67)
        self.assertIn("forecast_days=10", url)
        self.assertIn("models=best_match", url)

    @patch("aeis_dashboard.services.domain.fetch_weather_for_county")
    def test_national_weather_response_is_shared_from_cache(self, mocked_fetch):
        cache.delete("weather:national:v2")
        cache.delete("weather:national:v2:stale")
        cache.delete("weather:national:v2:refreshing")

        def weather_row(feature):
            return {
                "provider": "Open-Meteo forecast API",
                "provider_status": "live",
                "county": domain.county_name(feature),
                "county_code": domain.county_code(feature),
                "daily": [{"precipitation_sum": 1.0}],
                "risk": "Low",
            }

        mocked_fetch.side_effect = weather_row
        first = self.client.get("/api/weather/forecast")
        second = self.client.get("/api/weather/forecast")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(mocked_fetch.call_count, 47)
        self.assertTrue(second.json()["cached"])


def tearDownModule():
    shutil.rmtree(TEST_MEDIA_ROOT, ignore_errors=True)
