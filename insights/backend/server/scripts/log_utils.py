import logging
import os
import sys

def configure_logging(level_str="INFO", log_file="codeinsight.log", console_output=True):
    """
    Configures the root logger to write to console and a shared log file.
    The log file is placed in server/logs/codeinsight.log.

    Args:
        level_str: Log level (DEBUG, INFO, WARNING, ERROR)
        log_file: Log file name
        console_output: If True, also log to stdout; if False, only log to file
    """
    # Determine path to server/logs directory
    # This script is in server/scripts/, so go up one level to server/ then into logs/
    script_dir = os.path.dirname(os.path.abspath(__file__))
    server_dir = os.path.dirname(script_dir)
    log_dir = os.path.join(server_dir, "logs")

    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, log_file)

    level = getattr(logging, level_str.upper(), logging.INFO)

    # Define format including process ID for multi-process debugging
    log_format = "%(asctime)s %(levelname)s [%(process)d] %(name)s: %(message)s"


    from logging.handlers import RotatingFileHandler
    
    handlers = [RotatingFileHandler(log_path, maxBytes=2*1024*1024, backupCount=5, encoding='utf-8')]
    if console_output:
        handlers.insert(0, logging.StreamHandler(sys.stdout))

    logging.basicConfig(
        level=level,
        format=log_format,
        handlers=handlers,
        force=True
    )
