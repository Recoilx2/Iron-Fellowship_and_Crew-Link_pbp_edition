# Tenant seed for the self-hosted realtime container (forked from upstream
# supabase/realtime v2.148.3 priv/repo/seeds.exs, ticket #152).
#
# One change from upstream: the tenant's jwt_secret is always nil. Upstream
# defaults it to a well-known constant when API_JWT_SECRET is unset, and
# copies API_JWT_SECRET into the tenant when it is set — either way the
# tenant would accept HS256 tokens. This stack configures no such secret at
# all and verifies tokens with the asymmetric public JWKS (API_JWT_JWKS,
# RS256) only. Realtime's /api endpoints therefore refuse every caller
# (check_auth has no secret to verify against), which is why the container
# health check probes the unauthenticated /healthcheck route instead.
#
# Mounted read-only over the image's copy by docker-compose.yml; the mount
# path names the pinned image version, and tests/template.test.mjs keeps the
# two in sync. If API_JWT_JWKS is missing the seed fails loudly and the
# container never comes up.
require Logger

import Ecto.Adapters.SQL, only: [query: 3]

alias Realtime.Api
alias Realtime.Api.Tenant
alias Realtime.Env
alias Realtime.Repo
alias Realtime.Tenants

jwks_json = System.get_env("API_JWT_JWKS")

if jwks_json in [nil, ""] do
  raise("API_JWT_JWKS must be set: this stack verifies tokens with the asymmetric public JWKS only")
end

tenant_name = System.get_env("SELF_HOST_TENANT_NAME", "realtime-dev")
default_db_host = "host.docker.internal"

{:ok, _flag} = Api.upsert_feature_flag(%{name: "gcm_encryption_backfill", enabled: true})

{:ok, tenant} =
  Repo.transaction(fn ->
    case Repo.get_by(Tenant, external_id: tenant_name) do
      %Tenant{} = tenant -> Repo.delete!(tenant)
      nil -> {:ok, nil}
    end

    %Tenant{}
    |> Tenant.changeset(%{
      "name" => tenant_name,
      "external_id" => tenant_name,
      # No symmetric tenant secret: tokens are verified through jwt_jwks.
      "jwt_secret" => nil,
      "jwt_jwks" => Jason.decode!(jwks_json),
      "extensions" => [
        %{
          "type" => "postgres_cdc_rls",
          "settings" => %{
            "db_name" => System.get_env("DB_NAME", "postgres"),
            # The tenant shares Realtime's own database unless told otherwise.
            "db_host" => System.get_env("SELF_HOST_TENANT_DB_HOST") || System.get_env("DB_HOST", default_db_host),
            "db_user" => System.get_env("DB_USER", "supabase_admin"),
            "db_password" => System.get_env("DB_PASSWORD", "postgres"),
            "db_port" => System.get_env("SELF_HOST_TENANT_DB_PORT") || System.get_env("DB_PORT", "5433"),
            "region" => "us-east-1",
            "poll_interval_ms" => 100,
            "poll_max_record_bytes" => 1_048_576,
            "ssl_enforced" => Env.get_boolean("DB_SSL", false)
          }
        }
      ]
    })
    |> Repo.insert!()
  end)

tenant = Tenants.get_tenant_by_external_id(tenant_name)

with res when res in [:noop, :ok] <- Tenants.Migrations.run_migrations(tenant),
     :ok <- Tenants.Janitor.MaintenanceTask.run(tenant.external_id) do
  Logger.info("Tenant set-up successfully")
else
  error ->
    Logger.info("Failed to set-up tenant: #{inspect(error)}")
end
