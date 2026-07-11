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

include(CTest)
if(BUILD_TESTING)
    add_executable(game_logic_tests
        tests/game_logic_tests.cpp
    )
    target_link_libraries(game_logic_tests
        PRIVATE
            Boost::system
            Threads::Threads
    )
    target_compile_definitions(game_logic_tests
        PRIVATE
            DZ_NO_MAIN
            WEB_ROOT="${WEB_ROOT_COMPILE_PATH}"
    )
    add_test(NAME game_logic_tests COMMAND game_logic_tests)
endif()
