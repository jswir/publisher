# Multi-stage Dockerfile for Malloy Slack Bot
# Production-ready with security best practices and cloud optimization

# =============================================================================
# Build Stage: Install dependencies and prepare the environment
# =============================================================================
FROM python:3.11-slim as builder

# Install system dependencies needed for building Python packages
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create and activate virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Upgrade pip and install wheel for faster builds
RUN pip install --no-cache-dir --upgrade pip wheel

# Copy requirements first for better Docker layer caching
COPY requirements.txt .

# Install Python dependencies in virtual environment
RUN pip install --no-cache-dir -r requirements.txt

# =============================================================================
# Production Stage: Minimal runtime image
# =============================================================================
FROM python:3.11-slim as production

# Set metadata labels
LABEL maintainer="Malloy Slack Bot" \
      version="1.0.0" \
      description="Production-ready Malloy Slack Bot for cloud deployment"

# Install only essential runtime dependencies
RUN apt-get update && apt-get install -y \
    curl \
    dumb-init \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user for security
RUN groupadd -r malloy && \
    useradd -r -g malloy -d /app -s /bin/bash malloy

# Copy virtual environment from builder stage
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Set working directory
WORKDIR /app

# Copy application code with proper ownership
COPY --chown=malloy:malloy . .

# Create necessary directories with proper permissions
RUN mkdir -p /app/logs /app/tmp && \
    chown -R malloy:malloy /app && \
    chmod -R 755 /app

# Switch to non-root user
USER malloy

# Set production environment variables
ENV PYTHONPATH=/app \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    ENVIRONMENT=production \
    PORT=8080

# Expose health check port
EXPOSE 8080

# Health check configuration
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Default command
CMD ["python", "bot.py"] 