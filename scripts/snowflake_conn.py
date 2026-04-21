"""Snowflake 연결 헬퍼 — 서비스 계정 + JWT(private key) 인증.

환경변수 (.env.local):
  SNOWFLAKE_ACCOUNT
  SNOWFLAKE_USERNAME            서비스 계정명 (예: SVC_ORG_FPA)
  SNOWFLAKE_PRIVATE_KEY         PEM 포맷 private key (여러 줄, \\n 이스케이프 허용)
  SNOWFLAKE_WAREHOUSE
  SNOWFLAKE_DATABASE
  SNOWFLAKE_SCHEMA
  SNOWFLAKE_ROLE

사용:
  from snowflake_conn import get_connection
  conn = get_connection()
"""

from __future__ import annotations

import os

import snowflake.connector
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization


def _load_private_key_der() -> bytes:
    pem = os.environ["SNOWFLAKE_PRIVATE_KEY"].replace("\\n", "\n").encode("utf-8")
    p_key = serialization.load_pem_private_key(
        pem, password=None, backend=default_backend()
    )
    return p_key.private_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )


def get_connection():
    return snowflake.connector.connect(
        account=os.environ["SNOWFLAKE_ACCOUNT"],
        user=os.environ["SNOWFLAKE_USERNAME"],
        authenticator="SNOWFLAKE_JWT",
        private_key=_load_private_key_der(),
        warehouse=os.environ["SNOWFLAKE_WAREHOUSE"],
        database=os.environ["SNOWFLAKE_DATABASE"],
        schema=os.environ["SNOWFLAKE_SCHEMA"],
        role=os.environ["SNOWFLAKE_ROLE"],
    )
