cmake_minimum_required(VERSION 3.20)

project(web_texas_webrtc LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Boost 1.74 REQUIRED COMPONENTS system)
find_package(Threads REQUIRED)

set(WEB_ROOT_PATH "${CMAKE_CURRENT_SOURCE_DIR}/web" CACHE PATH "Path to static web assets")
file(TO_CMAKE_PATH "${WEB_ROOT_PATH}" WEB_ROOT_COMPILE_PATH)

add_executable(web_texas_webrtc
    src/main.cpp
)

target_link_libraries(web_texas_webrtc
    PRIVATE
        Boost::system
        Threads::Threads
)

target_compile_definitions(web_texas_webrtc
    PRIVATE
        WEB_ROOT="${WEB_ROOT_COMPILE_PATH}"
)
