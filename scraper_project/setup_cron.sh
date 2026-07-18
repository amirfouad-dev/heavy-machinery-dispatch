#!/bin/bash

# Heavy Machinery Scraper - Cron Setup Script for Linux VPS

PROJECT_DIR=$(pwd)
VENV_PYTHON="$PROJECT_DIR/venv/bin/python3"

echo "Setting up Cron Job for the Heavy Machinery Scraper..."

# Check if virtual environment exists
if [ -f "$VENV_PYTHON" ]; then
    PYTHON_EXEC=$VENV_PYTHON
    echo "Using virtual environment Python at $PYTHON_EXEC"
else
    PYTHON_EXEC=$(which python3)
    echo "Warning: No venv found. Using system Python at $PYTHON_EXEC"
fi

# Define the cron job command (runs every 1 hour)
# We cd into the directory first to ensure relative paths (like db/) resolve correctly
CRON_JOB="0 * * * * cd $PROJECT_DIR && $PYTHON_EXEC main.py --run >> $PROJECT_DIR/scraper.log 2>&1"

# Check if the job already exists
(crontab -l 2>/dev/null | grep -F "$PROJECT_DIR/main.py --run") >/dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "Cron job already exists!"
else
    # Add the cron job
    (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
    echo "Cron job added successfully. The scraper will run every 1 hour."
    echo "Logs will be written to $PROJECT_DIR/scraper.log"
fi

