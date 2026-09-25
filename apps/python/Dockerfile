# Sandbox for the agent's run_python tool: one throwaway container per run, started with no
# network, a read-only root, memory/CPU/process limits and a non-root user (see
# apps/server/src/analysis/python.ts). Only the libraries below; nothing can be installed later.
FROM python:3.12-slim

RUN pip install --no-cache-dir \
      pandas==2.2.3 numpy==2.1.3 scipy==1.14.1 \
      openpyxl==3.1.5 xlsxwriter==3.2.0 \
      matplotlib==3.9.2 \
      python-docx==1.1.2 reportlab==4.2.5 pdfplumber==0.11.4 \
      tabulate==0.9.0 \
    && useradd --uid 1000 --create-home runner

# Phone-friendly chart defaults and Brazilian number formats (import corgi).
COPY matplotlibrc /etc/matplotlibrc
COPY corgi.py /usr/local/lib/python3.12/site-packages/corgi.py

ENV MATPLOTLIBRC=/etc/matplotlibrc MPLCONFIGDIR=/tmp/matplotlib PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 LANG=C.UTF-8
USER 1000:1000
WORKDIR /work
